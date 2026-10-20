// Dash's readings, worked out from the session's usage: fuel, pace on each limit, the cache.
import type { Cache, Limit, Reading } from '../types'

export const H5 = 5 * 3_600_000
export const D7 = 7 * 86_400_000
/** The cache warning starts this long before it goes cold. */
export const WARN_MS = 120_000
/** Fuel at or under this calls a pit stop. */
export const PIT_AT = 20

export const DEFAULT_CACHE: Cache = { lastRequestAt: 0, ttlMs: 3_600_000 }

/** Theme keys, so the text follows the person's light or dark theme. */
export const C = { good: 'success', amber: 'warning', bad: 'error', dim: 'inactive', faint: 'subtle', text: 'text', cool: 'suggestion' } as const

/** Fuel is the context still free, 100 at the start of a session and falling. */
export const fuelOf = (r: Reading | null): number | null =>
  r && r.ctxTokens !== null && r.ctxWindow > 0 ? Math.max(0, Math.min(100, Math.round(100 - (100 * r.ctxTokens) / r.ctxWindow))) : null

export type Tone = 'good' | 'amber' | 'bad'
export const fuelTone = (f: number): Tone => (f <= PIT_AT ? 'bad' : f <= 45 ? 'amber' : 'good')
export const usedTone = (p: number): Tone => (p >= 80 ? 'bad' : p >= 55 ? 'amber' : 'good')
export const toneKey = (t: Tone) => C[t]
export const toneHex = (t: Tone) => (t === 'bad' ? '#ff4d4d' : t === 'amber' ? '#ffb23e' : '#5fd18a')

export const limitOf = (r: Reading | null, kind: string): Limit | null => r?.limits.find(l => l.kind === kind) ?? null

export type Pace = {
  pct: number
  /** Time until the window resets; null when the reading has no reset time. */
  resetsIn: number | null
  /** Where the window ends at the pace so far; null too early in the window to tell. */
  projected: number | null
  /** Time until it hits 100% at this pace; null when it makes it to the reset. */
  wallIn: number | null
}

/** The pace so far in a window `windowMs` long, carried to its reset. */
export const paceOf = (l: Limit, windowMs: number, now: number): Pace => {
  const pct = l.percentUsed
  const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  if (!Number.isFinite(reset)) return { pct, resetsIn: null, projected: null, wallIn: null }
  const resetsIn = Math.max(0, reset - now)
  const elapsed = windowMs - resetsIn
  // The first twentieth of a window is too little to read a pace from.
  if (elapsed < windowMs * 0.05 || pct <= 0) return { pct, resetsIn, projected: null, wallIn: null }
  const rate = pct / elapsed
  const projected = Math.round(pct + rate * resetsIn)
  const wallIn = projected >= 100 ? Math.max(0, (100 - pct) / rate) : null
  return { pct, resetsIn, projected, wallIn }
}

/** 42m, 1h 20m, 3d 4h. */
export const fmtSpan = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`
}

/** The 5-hour pace in a few words: for the line, and for the panel. */
export const fiveHourWords = (p: Pace) => {
  const reset = p.resetsIn !== null ? `resets in ${fmtSpan(p.resetsIn)}` : ''
  if (p.wallIn !== null) return { short: `wall in ${fmtSpan(p.wallIn)}`, long: `Hits the wall in ~${fmtSpan(p.wallIn)}`, tone: 'bad' as Tone }
  if (p.projected !== null) return { short: `clear · ${reset}`, long: `Won't hit the wall before it resets`, tone: (p.projected >= 85 ? 'amber' : 'good') as Tone }
  return { short: reset, long: '', tone: usedTone(p.pct) }
}

/** The weekly pace: where the week ends, and how early it runs dry when it does. */
export const weeklyWords = (p: Pace) => {
  if (p.projected === null) return { short: '', long: '', tone: usedTone(p.pct) }
  if (p.wallIn !== null && p.resetsIn !== null)
    return { short: `→ ${p.projected}%`, long: `On pace for ${p.projected}%. Runs dry ~${fmtSpan(p.resetsIn - p.wallIn)} early`, tone: 'bad' as Tone }
  return { short: `→ ${p.projected}%`, long: `Finishes the week at ~${p.projected}%`, tone: (p.projected >= 85 ? 'amber' : 'good') as Tone }
}


/** 156k, 1.2M. */
export const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

/** 52:09 under an hour; 1:02:09 past it. */
export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const mm = String(Math.floor(s / 60) % 60).padStart(s >= 3600 ? 2 : 1, '0')
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}

/** ▰▰▰▱▱: `pct` of `cells` filled. */
export const bar = (pct: number, cells: number) => {
  const full = Math.round((cells * Math.max(0, Math.min(100, pct))) / 100)
  return { full: '▰'.repeat(full), empty: '▱'.repeat(cells - full) }
}

/**
 * How long the prompt cache lasts, read from what a request wrote to it: five minutes when it
 * wrote only five-minute entries, an hour when it wrote hour ones, the last known value otherwise.
 * Same rule as Spotter's.
 */
export const cacheTtlOf = (usage: unknown, previous: number): number => {
  const w = (usage as { cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } } | null)?.cache_creation
  if ((w?.ephemeral_1h_input_tokens ?? 0) > 0) return 3_600_000
  if ((w?.ephemeral_5m_input_tokens ?? 0) > 0) return 300_000
  return previous
}

export const normalizeCache = (x: unknown): Cache => {
  const c = (x ?? {}) as Partial<Cache>
  return {
    lastRequestAt: typeof c.lastRequestAt === 'number' ? c.lastRequestAt : 0,
    ttlMs: typeof c.ttlMs === 'number' && c.ttlMs > 0 ? c.ttlMs : DEFAULT_CACHE.ttlMs,
  }
}
