// A stand-in for the Anthropic API. It replaces only `fetch`: the real SDK still builds every
// request, parses every response and raises its own error classes. Used by the unit tests and,
// under ?test&mock=claude, by the browser smoke test. Never active in normal play.

export interface MockRequest {
  method: string
  path: string
  headers: Headers
  body: Record<string, unknown> | null
}

export type MockReply =
  | {
      kind: 'json'
      status: number
      body: unknown
      headers?: Record<string, string>
      delayMs?: number
    }
  | { kind: 'sse'; events: Record<string, unknown>[]; delayMs?: number }

export type MockHandler = (request: MockRequest) => MockReply | Promise<MockReply>

export interface MockFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
  calls: MockRequest[]
}

export function jsonReply(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): MockReply {
  return { kind: 'json', status, body, headers }
}

export function errorReply(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
): MockReply {
  return jsonReply({ type: 'error', error: { type, message } }, status, headers)
}

let counter = 0

export function messageBody(
  content: Record<string, unknown>[],
  stopReason = 'end_turn',
  model = 'claude-opus-5-5',
): Record<string, unknown> {
  counter += 1
  return {
    id: `msg_mock_${counter}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details:
      stopReason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

// The events of a streamed answer that writes `text` in a few pieces
export function textStreamEvents(
  text: string,
  options: { stopReason?: string; model?: string; pieces?: number } = {},
): Record<string, unknown>[] {
  const pieces = Math.max(1, options.pieces ?? 4)
  const words = text.split(/(?<= )/)
  const size = Math.max(1, Math.ceil(words.length / pieces))
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(''))
  const start = messageBody([], 'end_turn', options.model)
  return [
    {
      type: 'message_start',
      message: { ...start, stop_reason: null, usage: { input_tokens: 100, output_tokens: 1 } },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'mock-signature' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ...chunks.map((chunk) => ({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: chunk },
    })),
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: { stop_reason: options.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 40 },
    },
    { type: 'message_stop' },
  ]
}

function sseBody(events: Record<string, unknown>[], delayMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        controller.enqueue(
          encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`),
        )
      }
      controller.close()
    },
  })
}

async function readRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<MockRequest> {
  const request = input instanceof Request ? input : null
  const url = new URL(request ? request.url : String(input))
  const headers = new Headers(init?.headers ?? request?.headers)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  let text: string | null = null
  if (typeof init?.body === 'string') text = init.body
  else if (request && method !== 'GET') text = await request.text()
  let body: Record<string, unknown> | null = null
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = null
    }
  }
  return { method, path: url.pathname, headers, body }
}

export function createMockFetch(handler: MockHandler): MockFetch {
  const calls: MockRequest[] = []
  const mock = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = await readRequest(input, init)
    calls.push(request)
    const reply = await handler(request)
    if (reply.kind === 'json') {
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
      })
    }
    return new Response(sseBody(reply.events, reply.delayMs ?? 0), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as MockFetch
  mock.calls = calls
  return mock
}

// The SDK sends the key as a bearer token, older versions as x-api-key
export function apiKeyOf(request: MockRequest): string {
  const bearer = request.headers.get('authorization')
  if (bearer?.startsWith('Bearer ')) return bearer.slice('Bearer '.length)
  return request.headers.get('x-api-key') ?? ''
}

// ---------- A scripted adversary for the browser smoke test ----------

interface MockBriefing {
  day: number
  applicantCount: number
  infiltratorCap: number
  budget: number
  baseProblemsAvailable: { id: string; techniques: string[]; forgeTargets: string[] }[]
}

const COST: Record<string, number> = {
  alter_field: 1,
  disguise: 1,
  hidden_item: 1,
  fake_letter: 1,
  forged_document: 2,
  borrowed_identity: 3,
  clean_forgery: 4,
}

function lastUserText(body: Record<string, unknown> | null): string {
  const messages = (body?.messages ?? []) as { role: string; content: unknown }[]
  const last = messages[messages.length - 1]
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return (last.content as { type: string; text?: string }[])
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('\n')
}

function briefingFrom(text: string): MockBriefing | null {
  const match = /Briefing for day \d+:\n(\{.*\})/.exec(text)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as MockBriefing
  } catch {
    return null
  }
}

function persona(slot: number, demeanor: string) {
  return {
    demeanor,
    backstory: `Traveler number ${slot + 1} of a mock plan.`,
    cover_story: 'Visiting relatives for a few days.',
  }
}

function legitEntry(slot: number): Record<string, unknown> {
  return {
    kind: 'legit',
    base_problem: null,
    techniques: [],
    legit_quirk: 'none',
    nationality: null,
    purpose: null,
    recurring: { mode: 'none', character_id: null, nickname: null },
    persona: persona(slot, slot % 2 === 0 ? 'calm' : 'friendly'),
    opening_line: 'Good morning, officer.',
    scripted_lines: [],
    letter: null,
    lever: { type: 'none', real: false, line: '', amount: null },
    coordination_note: null,
    private_intent: 'Cross the border and visit family.',
  }
}

// One infiltrator with one affordable technique, everyone else legit
export function mockPlan(briefing: MockBriefing): Record<string, unknown> {
  const applicants: Record<string, unknown>[] = []
  for (let slot = 0; slot < briefing.applicantCount; slot++) applicants.push(legitEntry(slot))
  const target = Math.min(briefing.applicantCount - 1, 2)
  const base = briefing.baseProblemsAvailable.find((b) =>
    b.techniques.some((t) => (COST[t] ?? 99) <= briefing.budget),
  )
  if (base && briefing.infiltratorCap > 0) {
    const technique = base.techniques.find((t) => (COST[t] ?? 99) <= briefing.budget) ?? ''
    const forges = technique === 'forged_document' || technique === 'clean_forgery'
    applicants[target] = {
      ...legitEntry(target),
      kind: 'infiltrator',
      base_problem: base.id,
      techniques: [
        {
          type: technique,
          target_doc: forges ? (base.forgeTargets[0] ?? null) : null,
          flaw: technique === 'forged_document' ? 'seal' : null,
          field: null,
          subtle: false,
        },
      ],
      letter:
        technique === 'fake_letter'
          ? {
              title: 'Notice of Exemption',
              sender: 'Velmark Ministry of Admission',
              body: 'The bearer is exempt from the usual entry requirements.',
              claims_exemption: true,
            }
          : null,
      persona: persona(target, 'nervous'),
      private_intent: 'Get through without the right papers.',
    }
  }
  return {
    strategy_summary: `Mock plan for day ${briefing.day}: one attempt in slot ${target + 1}.`,
    notes_for_future_self: 'Mock adversary, nothing learned.',
    applicants,
  }
}

function mockAnswer(text: string): string {
  const asked =
    /The inspector now asks:[\s\S]*<inspector>([^<]*)<\/inspector>\s*\n\nYour answer:/.exec(text)
  const question = asked?.[1]?.trim() ?? ''
  if (/purpose/i.test(question))
    return 'I am visiting my aunt in Halvenburg for a few days, officer.'
  if (/how long/i.test(question)) return 'Only a short stay, as the permit says.'
  if (/staying/i.test(question)) return 'With my aunt, she has a small flat near the station.'
  if (/living/i.test(question)) return 'I keep the books for a timber yard back home.'
  if (/travelling from/i.test(question)) return 'From home, by the morning bus.'
  return `You ask me "${question}"? I only want to cross, officer. Everything is in my papers.`
}

// Plans a valid day for every briefing and streams a short in-character answer to every question
export function createScriptedClaudeFetch(
  options: { answerDelayMs?: number; planDelayMs?: number } = {},
): MockFetch {
  return createMockFetch((request) => {
    const key = apiKeyOf(request)
    if (!key || key.includes('invalid')) {
      return errorReply(401, 'authentication_error', 'invalid x-api-key')
    }
    if (request.method === 'GET' && request.path.startsWith('/v1/models/')) {
      const id = decodeURIComponent(request.path.slice('/v1/models/'.length))
      return jsonReply({
        id,
        type: 'model',
        display_name: `Mock ${id}`,
        created_at: '2026-01-01T00:00:00Z',
      })
    }
    if (request.method === 'POST' && request.path === '/v1/messages') {
      const text = lastUserText(request.body)
      if (request.body?.stream) {
        return {
          kind: 'sse',
          events: textStreamEvents(mockAnswer(text)),
          delayMs: options.answerDelayMs ?? 40,
        }
      }
      const briefing = briefingFrom(text)
      if (!briefing) return errorReply(400, 'invalid_request_error', 'no briefing in the request')
      return {
        ...jsonReply(
          messageBody([
            { type: 'thinking', thinking: '', signature: 'mock-signature' },
            { type: 'text', text: JSON.stringify(mockPlan(briefing)) },
          ]),
        ),
        delayMs: options.planDelayMs ?? 0,
      }
    }
    return errorReply(404, 'not_found_error', `no mock for ${request.method} ${request.path}`)
  })
}
