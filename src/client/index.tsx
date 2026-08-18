/**
 * Session-scoped model and reasoning-effort control for the DSH composer model seat.
 *
 * The control deliberately follows DSH's own session model-selection contract:
 * `sessions.models()` supplies the exact current route and its adapter-owned
 * effort metadata; `sessions.selectModel()` submits the complete selection for
 * the next assembled turn. The slider adapts to whatever effort levels the
 * current model exposes — their count and order are the adapter's, never
 * assumed here.
 *
 * @module dsh-reasoning-effort/client
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelSelection, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ModelDirectory,
  ModelDirectoryResolver,
  ModelDirectoryState,
} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { CSS } from './styles.js'

/** One selectable effort exactly as the owning adapter advertised it. */
interface EffortLevel {
  readonly id: string
  readonly name: string
}

/** Host RPC result envelope (matches `@deepseek-ai/dsh-host-apiproxy`). */
type ReRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

interface HostRpc {
  call(channel: string, endpoint: string, payload?: unknown): Promise<unknown>
}

/** Channel the Host half registers its guidance endpoints on. */
const ADAPT_CHANNEL = '/dsh-reasoning-effort'

/** One guidance result from the Host half. */
interface AdaptGuidance {
  readonly provider: string
  readonly model: string
  readonly userDeclared: boolean
  readonly needsGuide: boolean
  readonly reason: 'missing' | 'mismatch' | 'none'
  readonly current: string[]
  readonly expected: string[]
  readonly matched: boolean
  readonly mode: 'replace' | 'insert'
  readonly note: string | null
  readonly warning: string | null
  readonly snippet: string
  readonly entryLine: string
  readonly entryPath: string
  readonly settingsPath: string | null
}

/** The client-facing guidance service (Client→Host over the Connection RPC). */
interface AdaptationService {
  diagnose(provider: string, model: string): Promise<AdaptGuidance | null>
}

const LEVEL_NAMES: Record<string, string> = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

function levelName(level: string): string {
  return LEVEL_NAMES[level] ?? level
}

function levelsText(levels: readonly string[]): string {
  return levels.length === 0 ? '无档位' : levels.map((level) => levelName(level)).join(' / ')
}

/** Wrap the Host RPC channel in typed helpers; null while the Host half is absent. */
function makeAdaptationService(rpc: HostRpc | undefined): AdaptationService | null {
  if (rpc === undefined) return null
  const call = async <T,>(endpoint: string, payload?: unknown): Promise<T | null> => {
    try {
      const result = (await rpc.call(ADAPT_CHANNEL, endpoint, payload)) as ReRpcResult<T>
      return result.ok ? result.value : null
    } catch {
      return null
    }
  }
  return {
    diagnose: (provider, model) => call<AdaptGuidance>('diagnose', { provider, model }),
  }
}

/** Copy text to the clipboard, falling back to a transient textarea selection. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }
}

interface ModelSeatProps {
  readonly locked: boolean
  readonly available: boolean
  readonly controller: ModelDirectory
  readonly directory: SnapshotStore<ModelDirectoryState>
  readonly load: () => void
  readonly select: (selection: ModelSelection) => Promise<boolean>
  readonly adapt: AdaptationService | null
}

const SLOT = 'conversation.input.model'
const SETTINGS_SLOT = 'settings.general.item'
const ENABLED_STORAGE_KEY = 'dsh-reasoning-effort.enabled'
const LEGACY_ENABLED_STORAGE_KEY = '@dsh-external/dsh-reasoning-effort.enabled'
export const inject = ['slots', 'modelDirectories', 'connection']

function readEnabledPreference(): boolean {
  try {
    const current = window.localStorage.getItem(ENABLED_STORAGE_KEY)
    const stored = current ?? window.localStorage.getItem(LEGACY_ENABLED_STORAGE_KEY)
    return stored !== 'false'
  } catch {
    return true
  }
}

let enabledPreference = readEnabledPreference()
const enabledListeners = new Set<() => void>()

const enabledStore = {
  getSnapshot: () => enabledPreference,
  subscribe: (listener: () => void) => {
    enabledListeners.add(listener)
    return () => enabledListeners.delete(listener)
  },
  set: (enabled: boolean, persist = true) => {
    if (enabledPreference === enabled) return
    enabledPreference = enabled
    if (persist) {
      try {
        window.localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled))
      } catch {
        // The current page still follows the choice when storage is unavailable.
      }
    }
    enabledListeners.forEach((listener) => listener())
  },
}

function currentModel(state: ModelDirectoryState) {
  if (state.current === null) return undefined
  const group = state.groups.find((candidate) => candidate.id === state.current?.provider)
  return group?.models.find((candidate) => candidate.id === state.current?.model)
}

/**
 * Effort levels the current model advertises, in adapter order. A model needs
 * at least two before a slider says anything a plain label would not, so
 * fewer-than-two collapses to none.
 */
function sliderLevels(state: ModelDirectoryState): readonly EffortLevel[] {
  const efforts = currentModel(state)?.reasoning?.efforts
  return efforts !== undefined && efforts.length >= 2 ? efforts : []
}

function effortIndex(levels: readonly EffortLevel[], id: string | undefined): number {
  return levels.findIndex((level) => level.id === id)
}

function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(value)))
}

/**
 * Level index the slider should rest at: the session's current effort when the
 * model still offers it, else the adapter default, else the middle level.
 */
function effectiveEffortIndex(levels: readonly EffortLevel[], state: ModelDirectoryState): number {
  const reasoning = currentModel(state)?.reasoning
  const current = effortIndex(levels, state.current?.reasoningEffort)
  if (current >= 0) return current
  const fallback = effortIndex(levels, reasoning?.defaultEffort)
  if (fallback >= 0) return fallback
  return Math.floor((levels.length - 1) / 2)
}

interface RadiationState {
  progress: number
  dragging: boolean
  warm: number
  purple: number
  floor: number
}

interface SliderPalette {
  c0: string
  c1: string
  c2: string
  glow: string
  warm: number
  purple: number
  floor: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function mixChannel(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount)
}

function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '')
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ]
}

function mixHex(from: string, to: string, amount: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  return `#${[0, 1, 2].map((index) => mixChannel(a[index]!, b[index]!, amount).toString(16).padStart(2, '0')).join('')}`
}

function mixStops(from: Omit<SliderPalette, 'warm' | 'purple' | 'floor'>, to: Omit<SliderPalette, 'warm' | 'purple' | 'floor'>, amount: number): Omit<SliderPalette, 'warm' | 'purple' | 'floor'> {
  return {
    c0: mixHex(from.c0, to.c0, amount),
    c1: mixHex(from.c1, to.c1, amount),
    c2: mixHex(from.c2, to.c2, amount),
    glow: mixHex(from.glow, to.glow, amount),
  }
}

function effortCaption(level: EffortLevel | undefined): string {
  const raw = level !== undefined && /^[\x20-\x7E]+$/.test(level.name) ? level.name : (level?.id ?? '')
  if (/^max$/i.test(raw)) return 'MAX'
  if (raw.length === 0) return ''
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

/** Codex-style palette: first stop is grey, then amber through orange, then magenta-purple. */
function sliderPalette(preview: number, count: number, dragging: boolean): SliderPalette {
  const last = Math.max(1, count - 1)
  const t = count < 2 ? 0 : clamp01(preview / last)
  const snappedTop = !dragging && preview >= last - 0.001
  const snappedFloor = !dragging && preview <= 0.02
  const floor = snappedFloor ? 1 : dragging && t < 0.14 ? 1 - t / 0.14 : 0
  const warm = count <= 2 ? 1 : clamp01(Math.min(preview, last - 1) / Math.max(1, last - 1))
  const purple = snappedTop ? 1 : t < 0.82 ? 0 : clamp01((t - 0.82) / 0.18)
  const grey = { c0: '#e4e4e8', c1: '#ececee', c2: '#f3f3f5', glow: '#d4d4d8' }
  const warmLow = { c0: '#4a2a08', c1: '#e8b03a', c2: '#f6c85a', glow: '#ffc14d' }
  const warmHigh = { c0: '#3a1604', c1: '#e07010', c2: '#ff8a12', glow: '#ff9a2a' }
  const purpleTop = { c0: '#1c0624', c1: '#8a14e8', c2: '#d24cff', glow: '#c85cff' }
  const mixed = mixStops(mixStops(mixStops(warmLow, warmHigh, warm), purpleTop, purple), grey, floor)
  return { ...mixed, warm, purple, floor }
}

function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const inset = Math.min(11, width * 0.08)
  const origin = inset + state.progress * Math.max(1, width - inset * 2)
  const isDark = document.body.hasAttribute('data-ds-dark-theme')
  const dense = state.purple > 0.45
  const cell = dense ? 2 : 3
  const speed = (state.dragging ? 2.8 : 1) * (dense ? 1.35 : 1)
  const warm = state.warm
  const purple = state.purple

  context.clearRect(0, 0, width, height)
  if (origin <= 0 || state.floor > 0.85) return

  context.save()
  context.beginPath()
  context.rect(0, 0, origin, height)
  context.clip()

  const warmColumn = isDark
    ? { r: [210, 255], g: [150, 96], b: [28, 8] }
    : { r: [214, 232], g: [142, 88], b: [36, 12] }
  const purpleColumn = isDark
    ? { r: [168, 226], g: [48, 72], b: [214, 255] }
    : { r: [156, 188], g: [64, 86], b: [206, 236] }
  const warmPixel = isDark
    ? { r: [230, 255], g: [164, 108], b: [36, 10] }
    : { r: [220, 236], g: [150, 96], b: [40, 16] }
  const purplePixel = isDark
    ? { r: [186, 236], g: [62, 92], b: [228, 255] }
    : { r: [164, 198], g: [72, 98], b: [214, 240] }

  const channel = (
    warmRange: { r: number[]; g: number[]; b: number[] },
    purpleRange: { r: number[]; g: number[]; b: number[] },
    heat: number,
  ): [number, number, number] => {
    const wr = mixChannel(warmRange.r[0]!, warmRange.r[1]!, heat)
    const wg = mixChannel(warmRange.g[0]!, mixChannel(warmRange.g[0]!, warmRange.g[1]!, warm), heat)
    const wb = mixChannel(warmRange.b[0]!, warmRange.b[1]!, heat)
    const pr = mixChannel(purpleRange.r[0]!, purpleRange.r[1]!, heat)
    const pg = mixChannel(purpleRange.g[0]!, purpleRange.g[1]!, heat)
    const pb = mixChannel(purpleRange.b[0]!, purpleRange.b[1]!, heat)
    return [mixChannel(wr, pr, purple), mixChannel(wg, pg, purple), mixChannel(wb, pb, purple)]
  }

  for (let x = 0; x < origin; x += cell) {
    const delta = x + cell * 0.5 - origin
    const distance = Math.abs(delta)
    const phaseA = distance / 10 - time * 0.0074 * speed
    const phaseB = distance / 23 - time * 0.0041 * speed + 1.7
    const phaseC = distance / 40 - time * 0.0022 * speed + 3.4
    const phaseD = distance / 7 - time * 0.011 * speed + 0.6
    const phaseE = distance / 15 - time * 0.0062 * speed + 2.5
    const sinA = Math.max(0, Math.sin(phaseA))
    const sinB = Math.max(0, Math.sin(phaseB))
    const sinC = Math.max(0, Math.sin(phaseC))
    const sinD = Math.max(0, Math.sin(phaseD))
    const sinE = Math.max(0, Math.sin(phaseE))
    const waveA = Math.pow(sinA, 2.6)
    const waveB = Math.pow(sinB, 3.2)
    const waveC = Math.pow(sinC, 4)
    const waveD = Math.pow(sinD, 2.2)
    const waveE = Math.pow(sinE, 3.4)
    const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * 0.78 + (dense ? Math.pow(sinD, 12) * 0.55 : 0)
    const wave = Math.min(1, waveA * 0.76 + waveB * 0.58 + waveC * 0.32 + (dense ? waveD * 0.55 + waveE * 0.4 : 0))
    const trail = 0.38 + 0.62 * Math.exp(-distance / Math.max(55, width * 0.72))
    const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * 0.0016)), 3) * 0.27
    const columnEnergy = trail * (wave * 1.04 + pillar + crest * 0.32)

    if (columnEnergy > 0.012) {
      const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))
      const [red, green, blue] = channel(warmColumn, purpleColumn, Math.min(1, nearness * 0.72 + wave * 0.28))
      const alpha = isDark
        ? Math.min(0.88, columnEnergy * 0.72)
        : Math.min(0.62, columnEnergy * 0.54)
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
      context.fillRect(x, 0, cell - 1, height)
    }

    for (let y = 0; y < height; y += cell) {
      const deltaY = y + cell * 0.5 - height * 0.5
      const radial = Math.hypot(delta / 38, deltaY / 11)
      const halo = Math.exp(-radial * 0.96) * 1.08
      const verticalShape = 0.58 + 0.42 * Math.cos((deltaY / height) * Math.PI)
      const grain = 0.72 + 0.28 * Math.sin(x * 0.73 + y * 1.31 + time * 0.006)
      const alpha = Math.min(0.96, (columnEnergy * 0.88 + halo + crest * 0.19) * verticalShape * grain)
      if (alpha < 0.035) continue

      const hot = Math.max(0, 1 - radial / 2.4)
      const [red, green, blue] = channel(warmPixel, purplePixel, Math.min(1, hot * 0.82 + crest * 0.18))
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${isDark ? alpha : alpha * 0.72})`
      context.fillRect(x, y, cell - 1, cell - 1)
    }
  }

  const streakWarm = isDark ? [255, 176, 64] : [214, 122, 18]
  const streakPurple = isDark ? [214, 132, 255] : [148, 64, 220]
  const streak = [
    mixChannel(streakWarm[0]!, streakPurple[0]!, purple),
    mixChannel(streakWarm[1]!, streakPurple[1]!, purple),
    mixChannel(streakWarm[2]!, streakPurple[2]!, purple),
  ]

  if (dense) {
    for (let waveIndex = 0; waveIndex < 6; waveIndex += 1) {
      const travel = (time * 0.09 * speed + waveIndex * 26) % Math.max(48, origin + 36)
      const waveX = origin - travel
      const pulse = 0.07 + 0.11 * Math.max(0, Math.sin(time * 0.004 + waveIndex))
      const band = context.createLinearGradient(waveX - 22, 0, waveX + 10, 0)
      band.addColorStop(0, `rgba(${streak[0]}, ${streak[1]}, ${streak[2]}, 0)`)
      band.addColorStop(0.55, `rgba(${streak[0]}, ${streak[1]}, ${streak[2]}, ${pulse})`)
      band.addColorStop(1, `rgba(255,255,255,${pulse * 0.55})`)
      context.fillStyle = band
      context.fillRect(waveX - 22, 0, 32, height)
    }
  }

  const particleCount = dense ? 28 : 14
  for (let i = 0; i < particleCount; i += 1) {
    const travel = (time * (state.dragging ? 0.16 : 0.065) * (0.78 + (i % 5) * 0.09) + i * 23) % Math.max(30, origin + 64)
    const particleX = origin - travel
    if (particleX < -24 || particleX > width + 16) continue
    const particleY = 2 + ((i * 11 + Math.sin(time * 0.003 + i) * 4) % Math.max(5, height - 4))
    const length = 4 + (i % 4) * 4 + (state.dragging ? 6 : 0) + (dense ? 2 : 0)
    const alpha = 0.28 + (i % 5) * 0.1
    const fade = context.createLinearGradient(particleX, 0, particleX + length, 0)
    fade.addColorStop(0, `rgba(${streak[0]}, ${streak[1]}, ${streak[2]}, 0)`)
    fade.addColorStop(0.68, `rgba(${streak[0]}, ${streak[1]}, ${streak[2]}, ${isDark ? alpha : alpha * 0.72})`)
    fade.addColorStop(1, isDark ? `rgba(255,244,228,${Math.min(1, alpha + 0.26)})` : `rgba(255,236,210,${Math.min(0.82, alpha + 0.18)})`)
    context.fillStyle = fade
    context.fillRect(particleX, particleY, length, i % 3 === 0 ? 2 : 1)
  }

  const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24)
  const mid = [
    mixChannel(255, 214, purple),
    mixChannel(176, 96, purple),
    mixChannel(64, 255, purple),
  ]
  glow.addColorStop(0, isDark ? 'rgba(255,255,255,.82)' : 'rgba(255,255,255,.86)')
  glow.addColorStop(0.14, isDark ? `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, .54)` : `rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, .48)`)
  glow.addColorStop(0.44, isDark ? `rgba(${mid[0]}, ${Math.max(40, mid[1] - 40)}, ${mid[2]}, .28)` : `rgba(${mid[0]}, ${Math.max(40, mid[1] - 40)}, ${mid[2]}, .22)`)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = glow
  context.fillRect(origin - 26, 0, 52, height)
  context.restore()
}

function EffortSlider({ directory }: { directory: ModelDirectory }) {
  const directoryState = useSyncExternalStore(
    (notify) => directory.store.subscribe(notify),
    () => directory.store.getSnapshot(),
  )
  const levels = sliderLevels(directoryState)
  const [effort, setEffort] = useState('')
  const [preview, setPreview] = useState(0)
  const [committing, setCommitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef('')
  const committingRef = useRef(false)
  const previewRef = useRef(0)
  const draggingRef = useRef(false)
  const pointerActiveRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const globalPointerMoveRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerEndRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerCancelRef = useRef<((event: PointerEvent) => void) | null>(null)
  const radiationRef = useRef<RadiationState>({ progress: 0.5, dragging: false, warm: 0.5, purple: 0, floor: 1 })
  const redrawRef = useRef<(() => void) | null>(null)
  const available = directoryState.current !== null && levels.length >= 2
  const busy = committing || directoryState.status === 'selecting'
  const error = localError ?? directoryState.error

  useEffect(() => {
    if (!available || committingRef.current || draggingRef.current) return
    const index = effectiveEffortIndex(levels, directoryState)
    const next = levels[index]?.id ?? ''
    committedRef.current = next
    previewRef.current = index
    setEffort(next)
    setPreview(index)
    setLocalError(null)
  }, [available, levels, directoryState])

  useEffect(() => {
    directory.load().catch(() => undefined)
  }, [directory])

  useEffect(() => {
    const palette = sliderPalette(preview, levels.length, dragging)
    previewRef.current = preview
    radiationRef.current.progress = levels.length >= 2 ? preview / (levels.length - 1) : 0.5
    radiationRef.current.warm = palette.warm
    radiationRef.current.purple = palette.purple
    radiationRef.current.floor = palette.floor
    radiationRef.current.dragging = dragging
    redrawRef.current?.()
  }, [preview, levels.length, dragging])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 1
    let height = 1
    let frame = 0

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = (time = performance.now()) => {
      drawRadiation(context, width, height, time, radiationRef.current)
    }

    const loop = (time: number) => {
      draw(time)
      frame = window.requestAnimationFrame(loop)
    }

    const redraw = () => {
      if (reducedMotion.matches) draw()
    }

    const resizeObserver = new ResizeObserver(() => {
      resize()
      draw()
    })
    const themeObserver = new MutationObserver(() => draw())
    resizeObserver.observe(canvas)
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    redrawRef.current = redraw
    resize()
    draw()
    if (!reducedMotion.matches) frame = window.requestAnimationFrame(loop)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      redrawRef.current = null
    }
  }, [])

  const rollback = useCallback(() => {
    const previous = committedRef.current
    previewRef.current = Math.max(0, effortIndex(levels, previous))
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    setEffort(previous)
    setPreview(Math.max(0, effortIndex(levels, previous)))
    setDragging(false)
  }, [levels])

  const commit = useCallback(async (raw: number) => {
    if (committingRef.current) return
    committingRef.current = true
    const previous = committedRef.current

    setDragging(false)
    setCommitting(true)
    setLocalError(null)

    // Optimistic snap from the rendered levels keeps the thumb responsive
    // while the directory round-trip revalidates against fresh data below.
    const optimisticIndex = clampIndex(raw, levels.length)
    const optimistic = levels[optimisticIndex]?.id
    if (optimistic !== undefined) {
      previewRef.current = optimisticIndex
      setPreview(optimisticIndex)
      setEffort(optimistic)
    }

    try {
      const models = await directory.load()
      const fresh: ModelDirectoryState = {
        current: models.current,
        routable: models.routable,
        groups: models.groups,
        failures: models.failures,
        status: 'ready',
        error: null,
      }
      const freshLevels = sliderLevels(fresh)
      const index = clampIndex(raw, freshLevels.length)
      const next = freshLevels[index]?.id
      if (next === undefined) throw new Error('当前模型未提供推理强度档位')

      previewRef.current = index
      setPreview(index)
      setEffort(next)

      await directory.select({
        provider: models.current.provider,
        model: models.current.model,
        reasoningEffort: next,
      })

      const snapshot = directory.store.getSnapshot()
      const accepted = effortIndex(freshLevels, snapshot.current?.reasoningEffort)
      const settled = accepted >= 0 ? accepted : index
      const settledId = freshLevels[settled]?.id ?? next
      committedRef.current = settledId
      previewRef.current = settled
      setEffort(settledId)
      setPreview(settled)
    } catch (cause) {
      const restore = Math.max(0, effortIndex(levels, previous))
      committedRef.current = previous
      previewRef.current = restore
      setEffort(previous)
      setPreview(restore)
      setLocalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      committingRef.current = false
      setCommitting(false)
    }
  }, [directory, levels])

  const rawFromPointer = (input: HTMLInputElement, clientX: number) => {
    const bounds = input.getBoundingClientRect()
    if (bounds.width <= 0 || levels.length < 2) return previewRef.current
    return Math.max(
      0,
      Math.min(levels.length - 1, (clientX - bounds.left) / bounds.width * (levels.length - 1)),
    )
  }

  const showPointerPreview = (raw: number) => {
    previewRef.current = raw
    setPreview(raw)
    setEffort(levels[clampIndex(raw, levels.length)]?.id ?? '')
  }

  const beginDragging = (input: HTMLInputElement, pointerId: number, clientX: number) => {
    pointerActiveRef.current = true
    activePointerIdRef.current = pointerId
    draggingRef.current = true
    setDragging(true)
    showPointerPreview(rawFromPointer(input, clientX))
    try {
      if (!input.hasPointerCapture(pointerId)) input.setPointerCapture(pointerId)
    } catch {
      // The window-level pointer listeners below remain the reliable fallback.
    }
  }

  const moveDragging = (input: HTMLInputElement, pointerId: number, clientX: number) => {
    if (!pointerActiveRef.current || activePointerIdRef.current !== pointerId) return
    showPointerPreview(rawFromPointer(input, clientX))
  }

  const stopDragging = (input: HTMLInputElement, pointerId?: number, clientX?: number) => {
    if (!pointerActiveRef.current) return
    if (pointerId !== undefined && activePointerIdRef.current !== pointerId) return
    const raw = clientX === undefined ? previewRef.current : rawFromPointer(input, clientX)
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    if (pointerId !== undefined && input.hasPointerCapture(pointerId)) {
      input.releasePointerCapture(pointerId)
    }
    showPointerPreview(raw)
    void commit(raw)
  }

  globalPointerMoveRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) moveDragging(input, event.pointerId, event.clientX)
  }
  globalPointerEndRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) stopDragging(input, event.pointerId, event.clientX)
  }
  globalPointerCancelRef.current = (event) => {
    if (activePointerIdRef.current !== event.pointerId) return
    rollback()
  }

  useEffect(() => {
    const move = (event: PointerEvent) => globalPointerMoveRef.current?.(event)
    const end = (event: PointerEvent) => globalPointerEndRef.current?.(event)
    const cancel = (event: PointerEvent) => globalPointerCancelRef.current?.(event)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const current = clampIndex(Number(event.currentTarget.value), levels.length)
    let target: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      target = Math.max(0, current - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      target = Math.min(levels.length - 1, current + 1)
    } else if (event.key === 'Home') {
      target = 0
    } else if (event.key === 'End') {
      target = levels.length - 1
    }
    if (target === undefined) return
    event.preventDefault()
    void commit(target)
  }

  if (!available) return null

  const count = levels.length
  const effortName = levels[effortIndex(levels, effort)]?.name ?? effort
  const t = count <= 1 ? 0 : preview / (count - 1)
  const palette = sliderPalette(preview, count, dragging)
  const isTop = palette.purple >= 0.98 || (!dragging && t >= 0.999)
  const isFloor = palette.floor >= 0.85
  const caption = effortCaption(levels[Math.round(preview)] ?? levels[effortIndex(levels, effort)])
  const style = {
    '--re-t': String(t),
    '--re-progress': `calc(var(--re-inset) + (100% - 2 * var(--re-inset)) * ${t})`,
    '--re-track-0': palette.c0,
    '--re-track-1': palette.c1,
    '--re-track-2': palette.c2,
    '--re-glow': palette.glow,
    '--re-warm': String(palette.warm),
    '--re-purple': String(palette.purple),
    '--re-floor': String(palette.floor),
  } as CSSProperties
  const title = error === null ? `思考强度 ${caption}` : `推理强度设置失败：${error}`

  return (
    <div
      className={`re-effort${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}${error === null ? '' : ' is-error'}${isFloor ? ' is-floor' : ''}${isTop ? ' is-top' : ''}`}
      title={title}
    >
      <div className="re-effort-caption" aria-hidden="true">
        <span className="re-effort-caption-label">思考强度</span>
        <span className={`re-effort-caption-value${isTop ? ' is-top' : ''}`}>{caption}</span>
      </div>
      <div
        className="re-effort-slider"
        data-top={isTop ? 'true' : undefined}
        data-floor={isFloor ? 'true' : undefined}
        style={style}
      >
        <div className="re-effort-track" aria-hidden="true" />
        {isTop ? null : (
          <div className="re-effort-ticks" aria-hidden="true">
            {levels.map((level, index) => (
              <span
                key={level.id}
                className={`re-effort-tick${Math.round(preview) === index ? ' is-current' : ''}`}
                style={{ left: `calc(var(--re-inset) + (100% - 2 * var(--re-inset)) * ${index / (count - 1)})` }}
              />
            ))}
          </div>
        )}
        <div className="re-effort-fx" aria-hidden="true">
          <canvas ref={canvasRef} className="re-effort-canvas" />
          <span className="re-effort-flare" />
        </div>
        <input
          ref={inputRef}
          className="re-effort-input"
          type="range"
          min="0"
          max={count - 1}
          step="0.01"
          value={preview}
          disabled={busy}
          aria-label="推理强度"
          aria-valuetext={effortName}
          onChange={(event) => {
            const raw = Number(event.currentTarget.value)
            showPointerPreview(raw)
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.focus()
            beginDragging(event.currentTarget, event.pointerId, event.clientX)
          }}
          onPointerMove={(event) => moveDragging(event.currentTarget, event.pointerId, event.clientX)}
          onPointerUp={(event) => stopDragging(event.currentTarget, event.pointerId, event.clientX)}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            rollback()
          }}
          onBlur={(event) => {
            stopDragging(event.currentTarget)
          }}
          onKeyDown={onKeyDown}
        />
        <span className="re-effort-knob" aria-hidden="true" />
      </div>
      {error === null ? null : <span className="re-effort-sr" role="status">{error}</span>}
    </div>
  )
}

function AdvancedModelSelect({
  locked,
  available,
  controller,
  directory,
  load,
  select,
  adapt,
}: ModelSeatProps) {
  const state = useSyncExternalStore(
    (notify) => directory.subscribe(notify),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [guidance, setGuidance] = useState<AdaptGuidance | null>(null)
  const [guidanceBusy, setGuidanceBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const choice = currentModel(state)
  const levels = sliderLevels(state)
  const effortName = levels[effectiveEffortIndex(levels, state)]?.name ?? '默认'
  const modelLabel = choice?.name ?? state.current?.model ?? '选择模型'
  const busy = state.status === 'loading' || state.status === 'selecting'

  useEffect(() => {
    if (!available) return
    load()
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setModelsOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const provider = state.current?.provider
  const modelId = state.current?.model

  useEffect(() => {
    if (adapt === null || provider === undefined || modelId === undefined) {
      setGuidance(null)
      setPanelOpen(false)
      return
    }
    let cancelled = false
    setGuidanceBusy(true)
    adapt.diagnose(provider, modelId).then((result) => {
      if (cancelled) return
      setGuidance(result)
      setGuidanceBusy(false)
      if (result === null || !result.needsGuide) setPanelOpen(false)
    }, () => {
      if (cancelled) return
      setGuidance(null)
      setGuidanceBusy(false)
    })
    return () => {
      cancelled = true
    }
  }, [adapt, provider, modelId])

  if (!available) return null

  const close = (restoreFocus = false) => {
    setOpen(false)
    setModelsOpen(false)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    if (modelsOpen) setModelsOpen(false)
    else close(true)
  }

  const chooseModel = async (provider: string, model: string, defaultEffort?: string) => {
    if (state.current?.provider === provider && state.current.model === model) {
      setModelsOpen(false)
      return
    }
    const accepted = await select({
      provider,
      model,
      ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }),
    })
    if (accepted) setModelsOpen(false)
  }

  return (
    <div ref={rootRef} className="re-model-root" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="re-model-trigger"
        aria-label={`模型 ${modelLabel}，推理强度 ${effortName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${modelLabel} · ${effortName}`}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else {
            setOpen(true)
            setModelsOpen(false)
            load()
          }
        }}
      >
        <span className="re-model-name">{modelLabel}</span>
        <span className="re-model-effort">{effortName}</span>
        <span className="re-model-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="re-model-menu" role="menu" aria-label="模型与推理强度" aria-busy={busy}>
          {modelsOpen ? (
            <div className="re-model-pane">
              <button type="button" className="re-model-back" onClick={() => setModelsOpen(false)}>
                <span aria-hidden="true">‹</span>
                <span>选择模型</span>
              </button>
              {state.status === 'loading' && state.groups.length === 0 ? (
                <div className="re-model-status">正在加载模型…</div>
              ) : null}
              {state.groups.map((group) => (
                <section key={group.id}>
                  <div className="re-model-group-title">{group.name}</div>
                  {group.models.map((model) => {
                    const selected = state.current?.provider === group.id && state.current.model === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className="re-model-option"
                        disabled={busy}
                        onClick={() => void chooseModel(group.id, model.id, model.reasoning?.defaultEffort)}
                      >
                        <span className="re-model-option-copy">
                          <span className="re-model-option-name">{model.name}</span>
                          {model.description === undefined ? null : (
                            <span className="re-model-option-desc">{model.description}</span>
                          )}
                        </span>
                        <span className="re-model-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                      </button>
                    )
                  })}
                </section>
              ))}
              {state.status === 'ready' && state.groups.every((group) => group.models.length === 0) ? (
                <div className="re-model-status">没有可用模型</div>
              ) : null}
              {state.error === null ? null : <div className="re-model-error">{state.error}</div>}
            </div>
          ) : (
            <>
              <div className="re-advanced">
                {levels.length >= 2 ? (
                  <EffortSlider directory={controller} />
                ) : (
                  <div className="re-model-status">当前模型未提供推理强度档位</div>
                )}
              </div>
              {guidance !== null && guidance.needsGuide ? (
                <div className="re-adapt">
                  <div className="re-adapt-copy">
                    <div className="re-adapt-title">
                      {guidance.reason === 'missing' ? '当前模型未提供推理强度档位' : '档位声明与知识库不一致'}
                    </div>
                    <div className="re-adapt-desc">
                      {guidance.matched
                        ? `知识库记录该模型支持 ${levelsText(guidance.expected)}，目录当前为 ${levelsText(guidance.current)}。${guidance.note ?? ''}`
                        : `目录当前为 ${levelsText(guidance.current)}。${guidance.note ?? ''}`}
                    </div>
                  </div>
                  {panelOpen ? (
                    <div className="re-adapt-panel">
                      <div className="re-adapt-scroll">
                        {guidance.matched ? (
                          <div className="re-adapt-panel-line">
                            <span className="re-adapt-arrow">{levelsText(guidance.current)}</span>
                            <span aria-hidden="true">→</span>
                            <span className="re-adapt-arrow">{levelsText(guidance.expected)}</span>
                          </div>
                        ) : null}
                        {guidance.warning === null ? null : (
                          <div className="re-adapt-warning">{guidance.warning}</div>
                        )}
                        <div className="re-adapt-label">要粘贴的内容</div>
                        <pre className="re-adapt-yaml">{guidance.snippet}</pre>
                        <div className="re-adapt-steps">
                          <span>
                            1. 打开 settings.yaml
                            {guidance.settingsPath === null ? '' : `（${guidance.settingsPath}）`}，
                            在 <code>{guidance.entryPath}</code> 列表里找到 <code>{guidance.entryLine}</code>；
                          </span>
                          {guidance.mode === 'replace' ? (
                            <span>
                              2. 把原有 <code>{guidance.entryLine}</code> 条目整体替换为复制的内容（不要复制出第二个 <code>llm-pi-ai:</code> 根）；
                            </span>
                          ) : (
                            <span>
                              2. 该行末尾回车，粘贴上面复制的内容（缩进与 <code>id</code> 差 2 个空格；不要复制出第二个 <code>llm-pi-ai:</code> 根）；
                            </span>
                          )}
                          <span>3. 保存后自动生效；滑块未出现则重启 Web Host 并刷新页面。</span>
                        </div>
                      </div>
                      <div className="re-adapt-actions">
                        <button
                          type="button"
                          className="re-adapt-apply"
                          onClick={() => {
                            void copyText(guidance.snippet).then((ok) => setCopied(ok))
                          }}
                        >
                          {copied ? '已复制 ✓' : '复制字段块'}
                        </button>
                        <button type="button" className="re-adapt-cancel" onClick={() => setPanelOpen(false)}>
                          收起
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="re-adapt-open" onClick={() => { setCopied(false); setPanelOpen(true) }}>
                      {guidanceBusy ? '检测中…' : '查看档位声明指引'}
                    </button>
                  )}
                </div>
              ) : null}
              <div className="re-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="re-model-row"
                disabled={busy}
                onClick={() => setModelsOpen(true)}
              >
                <span className="re-model-row-name">{modelLabel}</span>
                <span className="re-model-row-effort">{effortName}</span>
                <span className="re-row-chevron" aria-hidden="true">›</span>
              </button>
              {state.error === null ? null : <div className="re-model-error">{state.error}</div>}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ReasoningEffortSetting() {
  const enabled = useSyncExternalStore(enabledStore.subscribe, enabledStore.getSnapshot)

  return (
    <div className="re-setting-row">
      <div className="re-setting-copy">
        <div className="re-setting-title">推理强度滑块</div>
        <div className="re-setting-description">在模型菜单中显示推理强度滑块和动态辐射特效，档位随当前模型自动适配</div>
      </div>
      <div className="re-setting-control">
        <span className="re-setting-state">{enabled ? '启用' : '停用'}</span>
        <button
          type="button"
          role="switch"
          aria-label="启用推理强度滑块"
          aria-checked={enabled}
          className={`re-setting-switch${enabled ? ' is-on' : ''}`}
          onClick={() => enabledStore.set(!enabled)}
        >
          <span className="re-setting-switch-knob" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export function apply(ctx: ClientContext) {
  const modelDirectories = ctx.get('modelDirectories') as ModelDirectoryResolver | undefined
  if (modelDirectories === undefined) return

  const connection = ctx.get('connection') as { rpc?: HostRpc } | undefined
  const adapt = makeAdaptationService(connection?.rpc)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-reasoning-effort'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'reasoning-effort: styles')

  ctx.effect(() => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key === ENABLED_STORAGE_KEY) {
        enabledStore.set(event.newValue !== 'false', false)
      }
    }
    window.addEventListener('storage', syncStorage)
    return () => window.removeEventListener('storage', syncStorage)
  }, 'reasoning-effort: preference sync')

  ctx.slots.inject(SETTINGS_SLOT, () =>
    ctx.slots.register(
      { name: SETTINGS_SLOT, id: 'reasoning-effort-enabled', order: 15 },
      ReasoningEffortSetting,
    ),
  )

  ctx.slots.inject(SLOT, () => {
    let disposeModelSeat: (() => void) | undefined
    const syncModelSeat = () => {
      if (!enabledStore.getSnapshot()) {
        disposeModelSeat?.()
        disposeModelSeat = undefined
        return
      }
      if (disposeModelSeat !== undefined) return
      disposeModelSeat = ctx.slots.register(
        {
          name: SLOT,
          priority: -100,
          inject: (sessionId: SessionId) => {
            const controller = modelDirectories.directoryFor(sessionId)
            return {
              available: true,
              controller,
              directory: controller.store,
              load: () => controller.load().then(() => undefined, () => undefined),
              select: (selection: ModelSelection) => controller.select(selection).then(() => true, () => false),
              adapt,
            }
          },
        },
        AdvancedModelSelect,
      )
    }

    const unsubscribe = enabledStore.subscribe(syncModelSeat)
    syncModelSeat()
    return () => {
      unsubscribe()
      disposeModelSeat?.()
    }
  })
}
