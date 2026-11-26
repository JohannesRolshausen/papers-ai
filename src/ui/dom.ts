// Small DOM helpers. Text always goes in through textContent, never through innerHTML,
// because applicant lines, letters and names come from a language model in package 4.

export type Child = Node | string | null | undefined | false

export interface ElOptions {
  className?: string
  text?: string
  title?: string
  attrs?: Record<string, string>
  ref?: string
  onClick?: (event: MouseEvent) => void
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = options.text
  if (options.title !== undefined) node.title = options.title
  if (options.ref !== undefined) node.dataset.ref = options.ref
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value)
  }
  const onClick = options.onClick
  if (onClick) node.addEventListener('click', (event) => onClick(event as MouseEvent))
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.append(child)
  }
  return node
}

export function button(
  label: string,
  onClick: (event: MouseEvent) => void,
  className = 'btn',
): HTMLButtonElement {
  const node = el('button', { className, text: label, onClick })
  node.type = 'button'
  return node
}

export function clear(node: Element): void {
  node.replaceChildren()
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = Math.floor(minute % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return `${sign}${Math.abs(Math.round(amount))} cr`
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Stable small hash for cosmetic choices such as coat colors
export function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
