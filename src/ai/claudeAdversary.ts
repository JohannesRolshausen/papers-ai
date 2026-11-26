// The Claude adversary: a language model plans every day and answers in character.
//
// Planning keeps one conversation over the whole game. Each day appends the briefing (with the
// report on the day before) as a user turn and the model's response, unchanged, as an
// assistant turn. Nothing earlier is ever edited, so the prompt cache and the model's thinking
// stay valid. When a day cannot be planned by Claude, the offline adversary plans it, the
// unanswered user turn is not kept and the next briefing says what happened.
//
// Interviews are single requests: the persona prompt (cached), the dossier of the person
// (cached while that person stands at the window), the conversation so far and the question.

import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type {
  Adversary,
  AdversaryKeyProblem,
  PlanRequest,
  PlanResult,
  RespondRequest,
} from './adversary'
import { AdversaryKeyError } from './adversary'
import {
  PERSONA_SYSTEM_PROMPT,
  cleanAnswer,
  personaDossierText,
  personaTurnText,
  plannerSystemPrompt,
  plannerUserMessage,
} from './prompts'
import type { DayPlan } from './schema'
import { DayPlanSchema } from './schema'

// ---------- Models ----------

export interface ClaudeModelInfo {
  id: string
  label: string
  note: string
}

export const CLAUDE_MODELS: readonly ClaudeModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Default. The most cunning plans.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster and cheaper.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest.' },
]

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

export function isClaudeModel(model: string): boolean {
  return CLAUDE_MODELS.some((m) => m.id === model)
}

// ---------- Request settings ----------

// Non-streaming requests above about 21k output tokens need streaming in the SDK. A plan for
// 16 people with short texts fits well below this, thinking included.
export const PLAN_MAX_TOKENS = 20000
// Thinking counts toward max_tokens, the spoken answer itself is one or two sentences
export const ANSWER_MAX_TOKENS = 1024
// Opt-in server-side retry on another model when a request is declined for policy reasons.
// "default" lets the API choose the fallback model. On a model without fallbacks the request
// simply runs on the requested model alone.
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// A plan may take minutes at high effort. An answer keeps the player waiting at the window,
// so it gets a short limit and no SDK retry: the offline answer is better than a long wait.
const PLAN_TIMEOUT_MS = 300_000
const ANSWER_TIMEOUT_MS = 25_000
const PLAN_RATE_LIMIT_RETRIES = 3
const ANSWER_RATE_LIMIT_RETRIES = 1
const PLAN_MAX_WAIT_MS = 30000
const ANSWER_MAX_WAIT_MS = 3000

// ---------- Memory ----------

export interface ClaudeDayLog {
  day: number
  source: 'claude' | 'fallback'
  // Model that produced the plan, can differ from the requested one after a server fallback
  model: string | null
  reason: PlanFailure | null
}

export interface ClaudeMemory {
  version: 1
  kind: 'claude'
  // Complete user and assistant turns of the planning conversation, oldest first
  messages: BetaMessageParam[]
  // Days whose report is part of the conversation
  reported: number[]
  // Told to the model in the next briefing, for example that a plan could not be used
  notes: string[]
  log: ClaudeDayLog[]
  // Memory of the offline adversary that plans the days Claude cannot
  offline: unknown
}

function emptyMemory(): ClaudeMemory {
  return {
    version: 1,
    kind: 'claude',
    messages: [],
    reported: [],
    notes: [],
    log: [],
    offline: null,
  }
}

function isMessage(value: unknown): value is BetaMessageParam {
  if (!value || typeof value !== 'object') return false
  const m = value as { role?: unknown; content?: unknown }
  return (
    (m.role === 'user' || m.role === 'assistant') &&
    (typeof m.content === 'string' || Array.isArray(m.content))
  )
}

// Accepts only a well-formed memory of this adversary: pairs of user and assistant turns
export function isClaudeMemory(value: unknown): value is ClaudeMemory {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<ClaudeMemory>
  if (m.version !== 1 || m.kind !== 'claude') return false
  if (!Array.isArray(m.messages) || !Array.isArray(m.reported) || !Array.isArray(m.notes)) {
    return false
  }
  if (!Array.isArray(m.log)) return false
  if (m.messages.length % 2 !== 0) return false
  return m.messages.every(
    (msg, i) => isMessage(msg) && msg.role === (i % 2 === 0 ? 'user' : 'assistant'),
  )
}

// ---------- Failures ----------

export type PlanFailure = 'refusal' | 'invalid' | 'network' | 'rate_limit' | 'api'

const PLAN_NOTICE: Record<PlanFailure, string> = {
  refusal: 'Claude declined to plan this day. The offline adversary planned the line instead.',
  invalid:
    'Claude sent a plan that could not be read. The offline adversary planned the line instead.',
  network: 'Claude could not be reached. The offline adversary planned the line instead.',
  rate_limit: 'Claude is busy (rate limit). The offline adversary planned the line instead.',
  api: 'Claude returned an error. The offline adversary planned the line instead.',
}

const PLAN_NOTE: Record<PlanFailure, string> = {
  refusal: 'was declined',
  invalid: 'could not be read as a DayPlan (invalid or cut off)',
  network: 'never arrived because of a network error',
  rate_limit: 'never arrived because of a rate limit',
  api: 'never arrived because of an API error',
}

const KEY_MESSAGES: Record<AdversaryKeyProblem, string> = {
  missing: 'This game plays against Claude. Enter your API key to continue.',
  auth: 'Claude rejected the API key. Check the key and try again.',
  permission: 'This API key is not allowed to use the Claude API.',
  model: 'This API key cannot use the chosen model. Pick another model or key.',
  billing: 'The Anthropic account behind this key has a billing problem.',
}

type Classified =
  { kind: 'key'; problem: AdversaryKeyProblem } | { kind: 'failure'; failure: PlanFailure }

// Most specific first. APIConnectionError is a subclass of APIError in the TypeScript SDK.
export function classifyError(error: unknown): Classified {
  if (error instanceof AdversaryKeyError) return { kind: 'key', problem: error.problem }
  if (error instanceof Anthropic.AuthenticationError) return { kind: 'key', problem: 'auth' }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { kind: 'key', problem: 'permission' }
  }
  if (error instanceof Anthropic.NotFoundError) return { kind: 'key', problem: 'model' }
  if (error instanceof Anthropic.PaymentRequiredError) return { kind: 'key', problem: 'billing' }
  if (error instanceof Anthropic.RateLimitError) return { kind: 'failure', failure: 'rate_limit' }
  if (error instanceof Anthropic.APIConnectionError) return { kind: 'failure', failure: 'network' }
  if (error instanceof Anthropic.APIUserAbortError) return { kind: 'failure', failure: 'network' }
  if (error instanceof Anthropic.APIError) return { kind: 'failure', failure: 'api' }
  // The SDK reports structured output it cannot parse as a plain AnthropicError
  if (error instanceof Anthropic.AnthropicError) return { kind: 'failure', failure: 'invalid' }
  return { kind: 'failure', failure: 'invalid' }
}

// Seconds from the retry-after header, otherwise exponential: 2 s, 4 s, 8 s
export function retryDelayMs(
  error: InstanceType<typeof Anthropic.RateLimitError>,
  attempt: number,
): number {
  const header = error.headers?.get('retry-after') ?? null
  const seconds = header === null ? Number.NaN : Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(250, seconds * 1000)
  return 2000 * 2 ** attempt
}

// After a mid-output server fallback, thinking and tool blocks before the last fallback block
// must not be echoed back. Everything else goes back exactly as it arrived.
export function echoContent<T extends { type: string }>(content: readonly T[]): T[] {
  let last = -1
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i
  })
  if (last < 0) return [...content]
  const dropped = new Set(['thinking', 'redacted_thinking', 'tool_use'])
  return content.filter((b, i) => i >= last || !dropped.has(b.type))
}

// ---------- The adversary ----------

export type ClaudeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ClaudeAdversaryOptions {
  apiKey: string | null
  model: string
  // Plans the days Claude cannot plan, usually the offline adversary
  fallback: Adversary
  // Replaces the network for tests and the browser mock
  fetch?: ClaudeFetch
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
}

export type NoticeListener = (text: string) => void

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createClaudeClient(
  apiKey: string,
  options: { fetch?: ClaudeFetch; maxRetries?: number } = {},
): Anthropic {
  return new Anthropic({
    apiKey,
    // The key belongs to the player and stays in this browser
    dangerouslyAllowBrowser: true,
    maxRetries: options.maxRetries ?? 1,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
}

export class ClaudeAdversary implements Adversary {
  readonly mode = 'claude' as const
  private apiKey: string | null
  private modelId: string
  private client: Anthropic | null = null
  private readonly fallback: Adversary
  private readonly fetchImpl: ClaudeFetch | undefined
  private readonly maxRetries: number | undefined
  private readonly sleep: (ms: number) => Promise<void>
  private memory: ClaudeMemory = emptyMemory()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<NoticeListener>()
  // Set while the key is missing or rejected. Interviews skip the API until a new key works.
  keyProblem: AdversaryKeyProblem | null = null

  constructor(options: ClaudeAdversaryOptions) {
    this.apiKey = options.apiKey && options.apiKey.trim() ? options.apiKey.trim() : null
    this.modelId = options.model
    this.fallback = options.fallback
    this.fetchImpl = options.fetch
    this.maxRetries = options.maxRetries
    this.sleep = options.sleep ?? defaultSleep
    if (!this.apiKey) this.keyProblem = 'missing'
  }

  get model(): string {
    return this.modelId
  }

  get hasKey(): boolean {
    return this.apiKey !== null
  }

  // A new key or model from the player, for example after a rejected key
  setCredentials(apiKey: string, model: string = this.modelId): void {
    const key = apiKey.trim()
    this.apiKey = key || null
    this.modelId = model
    this.client = null
    this.keyProblem = key ? null : 'missing'
  }

  // Short texts for the player when the adversary changes how it works mid-shift
  onNotice(listener: NoticeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(text: string): void {
    for (const listener of this.listeners) listener(text)
  }

  private getClient(): Anthropic {
    if (!this.apiKey) throw new AdversaryKeyError('missing', KEY_MESSAGES.missing)
    this.client ??= createClaudeClient(this.apiKey, {
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.maxRetries !== undefined ? { maxRetries: this.maxRetries } : {}),
    })
    return this.client
  }

  private async withBackoff<T>(
    call: () => Promise<T>,
    retries: number,
    maxWait: number,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call()
      } catch (error) {
        if (!(error instanceof Anthropic.RateLimitError) || attempt >= retries) throw error
        const wait = retryDelayMs(error, attempt)
        if (wait > maxWait) throw error
        await this.sleep(wait)
      }
    }
  }

  // ---------- Planning ----------

  planDay(request: PlanRequest): Promise<PlanResult> {
    // One planning request at a time keeps the conversation in order
    const run = this.queue.then(() => this.plan(request))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async plan(request: PlanRequest): Promise<PlanResult> {
    const day = request.briefing.dayIndex
    const reported = new Set(this.memory.reported)
    const previous = request.previous
    const missedHistory = request.history.filter(
      (o) => !reported.has(o.dayIndex) && o.dayIndex !== previous?.dayIndex,
    )
    const userMessage: BetaMessageParam = {
      role: 'user',
      content: plannerUserMessage({
        briefing: request.briefing,
        previous,
        missedHistory,
        notes: this.memory.notes,
      }),
    }
    try {
      const client = this.getClient()
      const response = await this.withBackoff(
        () =>
          client.beta.messages.parse(
            {
              model: this.modelId,
              max_tokens: PLAN_MAX_TOKENS,
              betas: [FALLBACK_BETA],
              fallbacks: 'default',
              thinking: { type: 'adaptive' },
              output_config: { effort: 'high', format: betaZodOutputFormat(DayPlanSchema) },
              // The conversation grows by whole days. A one-hour cache spans a shift and the
              // reports around it, the static manual has its own breakpoint before it.
              cache_control: { type: 'ephemeral', ttl: '1h' },
              system: [
                {
                  type: 'text',
                  text: plannerSystemPrompt(),
                  cache_control: { type: 'ephemeral', ttl: '1h' },
                },
              ],
              messages: [...this.memory.messages, userMessage],
            },
            { timeout: PLAN_TIMEOUT_MS },
          ),
        PLAN_RATE_LIMIT_RETRIES,
        PLAN_MAX_WAIT_MS,
      )
      if (response.stop_reason === 'refusal') return this.fallbackPlan(request, 'refusal')
      const parsed = response.parsed_output
      const checked = parsed ? DayPlanSchema.safeParse(parsed) : null
      if (!checked || !checked.success) return this.fallbackPlan(request, 'invalid')
      const plan: DayPlan = checked.data
      this.memory.messages.push(userMessage, {
        role: 'assistant',
        content: echoContent(response.content),
      })
      this.memory.reported = mergeDays(this.memory.reported, [
        ...missedHistory.map((o) => o.dayIndex),
        ...(previous ? [previous.dayIndex] : []),
      ])
      this.memory.notes = []
      this.log({ day, source: 'claude', model: response.model, reason: null })
      this.keyProblem = null
      return { plan, source: 'claude', notice: null }
    } catch (error) {
      const c = classifyError(error)
      if (c.kind === 'key') {
        this.keyProblem = c.problem
        throw new AdversaryKeyError(c.problem, KEY_MESSAGES[c.problem])
      }
      return this.fallbackPlan(request, c.failure)
    }
  }

  private async fallbackPlan(request: PlanRequest, failure: PlanFailure): Promise<PlanResult> {
    const day = request.briefing.dayIndex
    const result = await this.fallback.planDay(request)
    const note = `Your plan for day ${day} ${PLAN_NOTE[failure]}. The offline planner filled the line of day ${day}, so the report on day ${day} shows its people, not yours.`
    this.memory.notes = [...this.memory.notes.filter((n) => n !== note), note]
    this.log({ day, source: 'fallback', model: null, reason: failure })
    return { plan: result.plan, source: 'fallback', notice: PLAN_NOTICE[failure] }
  }

  private log(entry: ClaudeDayLog): void {
    this.memory.log = [...this.memory.log.filter((l) => l.day !== entry.day), entry]
  }

  // ---------- Interviews ----------

  async respond(request: RespondRequest, onText?: (partial: string) => void): Promise<string> {
    if (this.keyProblem) throw new Error('Claude needs a working API key')
    try {
      const client = this.getClient()
      return await this.withBackoff(
        () => this.streamAnswer(client, request, onText),
        ANSWER_RATE_LIMIT_RETRIES,
        ANSWER_MAX_WAIT_MS,
      )
    } catch (error) {
      const c = classifyError(error)
      if (c.kind === 'key') {
        this.keyProblem = c.problem
        this.notify(
          `${KEY_MESSAGES[c.problem]} Until then the offline adversary answers. You can enter a new key in the morning.`,
        )
      }
      throw error
    }
  }

  private async streamAnswer(
    client: Anthropic,
    request: RespondRequest,
    onText?: (partial: string) => void,
  ): Promise<string> {
    const stream = client.beta.messages.stream(
      {
        model: this.modelId,
        max_tokens: ANSWER_MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        system: [
          { type: 'text', text: PERSONA_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: personaDossierText(request.dossier),
                cache_control: { type: 'ephemeral' },
              },
              { type: 'text', text: personaTurnText(request) },
            ],
          },
        ],
      },
      { timeout: ANSWER_TIMEOUT_MS, maxRetries: 0 },
    )
    let text = ''
    stream.on('text', (delta) => {
      text += delta
      const partial = cleanAnswer(text)
      if (partial) onText?.(partial)
    })
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new Error('Claude declined to answer')
    const full = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const answer = cleanAnswer(full)
    if (!answer) throw new Error('Claude sent an empty answer')
    onText?.(answer)
    return answer
  }

  // ---------- Memory ----------

  exportMemory(): ClaudeMemory {
    return {
      ...this.memory,
      messages: [...this.memory.messages],
      reported: [...this.memory.reported],
      notes: [...this.memory.notes],
      log: [...this.memory.log],
      offline: this.fallback.exportMemory(),
    }
  }

  importMemory(memory: unknown): void {
    if (!isClaudeMemory(memory)) {
      // Memory of another adversary or a broken save: start a fresh conversation
      this.memory = emptyMemory()
      return
    }
    this.memory = {
      version: 1,
      kind: 'claude',
      messages: [...memory.messages],
      reported: [...memory.reported],
      notes: [...memory.notes],
      log: [...memory.log],
      offline: null,
    }
    if (memory.offline !== null && memory.offline !== undefined) {
      this.fallback.importMemory(memory.offline)
    }
  }

  // Planning turns held in the conversation, for tests and the debrief
  get conversation(): readonly BetaMessageParam[] {
    return this.memory.messages
  }

  get dayLog(): readonly ClaudeDayLog[] {
    return this.memory.log
  }
}

function mergeDays(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y)
}

// ---------- Checking a key ----------

export type KeyCheck =
  | { ok: true; model: string; message: string }
  | { ok: false; problem: AdversaryKeyProblem | PlanFailure; message: string }

// Asks the models endpoint about the chosen model: no tokens, no cost
export async function verifyClaudeKey(
  apiKey: string,
  model: string,
  options: { fetch?: ClaudeFetch } = {},
): Promise<KeyCheck> {
  const key = apiKey.trim()
  if (!key) return { ok: false, problem: 'missing', message: 'Enter an API key first.' }
  try {
    const client = createClaudeClient(key, { ...options, maxRetries: 0 })
    const info = await client.models.retrieve(model)
    return { ok: true, model: info.id, message: `Key accepted. ${info.display_name} is ready.` }
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: true, model, message: 'Key accepted, but the API is busy right now.' }
    }
    const c = classifyError(error)
    if (c.kind === 'key') return { ok: false, problem: c.problem, message: KEY_MESSAGES[c.problem] }
    const message =
      c.failure === 'network'
        ? 'The Anthropic API could not be reached. Check your connection.'
        : 'The key could not be checked right now. Try again in a moment.'
    return { ok: false, problem: c.failure, message }
  }
}
