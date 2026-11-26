// The fixed 1280x800 stage, scaled to fit the window, and dragging of desk items.

export const STAGE_W = 1280
export const STAGE_H = 800

let currentScale = 1

export function stageScale(): number {
  return currentScale
}

export function createStage(root: HTMLElement): HTMLElement {
  const stage = document.createElement('div')
  stage.className = 'stage'
  root.replaceChildren(stage)
  const fit = () => {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)
    currentScale = scale
    const left = (window.innerWidth - STAGE_W * scale) / 2
    const top = (window.innerHeight - STAGE_H * scale) / 2
    stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`
  }
  stage.style.left = '0'
  stage.style.top = '0'
  window.addEventListener('resize', fit)
  fit()
  return stage
}

let topZ = 10

export function bringToFront(node: HTMLElement): void {
  topZ += 1
  node.style.zIndex = String(topZ)
}

export interface DragOptions {
  bounds: HTMLElement
  // Return false to let the pointer event through, for example in inspect mode
  canDrag?(event: PointerEvent): boolean
}

const NO_DRAG = 'button, input, textarea, select, a, .no-drag'

export function makeDraggable(node: HTMLElement, options: DragOptions): void {
  node.classList.add('draggable')
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest(NO_DRAG)) {
      bringToFront(node)
      return
    }
    if (options.canDrag && !options.canDrag(event)) return
    bringToFront(node)
    event.preventDefault()
    const scale = stageScale()
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = node.offsetLeft
    const startTop = node.offsetTop
    const maxLeft = options.bounds.clientWidth - 40
    const maxTop = options.bounds.clientHeight - 30
    node.setPointerCapture(event.pointerId)
    node.classList.add('dragging')
    const move = (e: PointerEvent) => {
      const left = startLeft + (e.clientX - startX) / scale
      const top = startTop + (e.clientY - startY) / scale
      node.style.left = `${Math.round(Math.max(-node.offsetWidth + 60, Math.min(maxLeft, left)))}px`
      node.style.top = `${Math.round(Math.max(0, Math.min(maxTop, top)))}px`
    }
    const up = () => {
      node.classList.remove('dragging')
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', up)
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up)
    node.addEventListener('pointercancel', up)
  })
}

export function placeAt(node: HTMLElement, left: number, top: number): void {
  node.style.left = `${left}px`
  node.style.top = `${top}px`
}
