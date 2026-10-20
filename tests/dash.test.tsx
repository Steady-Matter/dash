import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { fiveHourWords, fuelOf, paceOf, weeklyWords } from '../hooks/core'

const NOW = Date.parse('2026-10-20T15:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

// ---------------------------------------------------------------- the math

test('fuel is the context still free, counting down from 100', () => {
  expect(fuelOf({ ctxTokens: 0, ctxWindow: 200_000, ctxLimit: null, limits: [] })).toBe(100)
  expect(fuelOf({ ctxTokens: 44_000, ctxWindow: 200_000, ctxLimit: null, limits: [] })).toBe(78)
  expect(fuelOf({ ctxTokens: null, ctxWindow: 200_000, ctxLimit: null, limits: [] })).toBeNull()
})

test('with an auto-compact point set, fuel runs out there, not at the model window', () => {
  expect(fuelOf({ ctxTokens: 265_000, ctxWindow: 1_000_000, ctxLimit: 500_000, limits: [] })).toBe(47)
  expect(fuelOf({ ctxTokens: 520_000, ctxWindow: 1_000_000, ctxLimit: 500_000, limits: [] })).toBe(0)
})

test('pace: 91% four hours into the 5-hour window hits the wall before the reset', () => {
  const p = paceOf({ kind: 'five_hour', percentUsed: 91, resetsAt: iso(NOW + 3_600_000) }, 5 * 3_600_000, NOW)
  expect(p.projected).toBe(114)
  expect(Math.round((p.wallIn ?? 0) / 60_000)).toBe(24)
  expect(fiveHourWords(p).short).toBe('wall in 24m')
})

test('pace: a light week finishes under 100 and says where', () => {
  const day = 86_400_000
  // Two days in, 20% used: 70% by the reset.
  const p = paceOf({ kind: 'seven_day', percentUsed: 20, resetsAt: iso(NOW + 5 * day) }, 7 * day, NOW)
  expect(p.projected).toBe(70)
  expect(p.wallIn).toBeNull()
  expect(weeklyWords(p).long).toBe('Finishes the week at ~70%')
})

test('pace: too early in a window to tell, so no projection', () => {
  const p = paceOf({ kind: 'five_hour', percentUsed: 4, resetsAt: iso(NOW + 5 * 3_600_000 - 60_000) }, 5 * 3_600_000, NOW)
  expect(p.projected).toBeNull()
})

// ---------------------------------------------------------------- drawing

const engine = (on: On, fill?: (text: string) => void) => {
  mock.clock(on, { now: NOW })
  on('session.measure', (_$, e) => ({ changed: e.changed }) as never)
  on('prompt.fill', (_$, e) => (fill?.((e as { text: string }).text), { isFilled: true }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }))
}

const measure = (tokens: number, h5: number, wk: number) => ({
  context: { window: 200_000, tokens, percent: (100 * tokens) / 200_000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: h5, resetsAt: iso(NOW + 3_600_000) },
    { kind: 'seven_day', percentUsed: wk, resetsAt: iso(NOW + 3 * 86_400_000) },
  ],
  changed: ['context', 'rateLimits'],
})

const band = (bodyColumns: number) => ({
  plugin: 'dash',
  component: 'AbovePrompt' as const,
  requestId: 'band',
  viewport: { columns: bodyColumns, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns, scroll: { offset: 0, bodyRows: 4 }, view: {} },
})

const pane = (bodyColumns: number) => ({
  plugin: 'dash',
  component: 'Pane' as const,
  requestId: 'dash',
  props: { title: 'Dash', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} },
})

test('the line shows fuel and both limits, and keeps the row beneath it', async ($, on) => {
  engine(on)
  await $.session.measure(measure(44_000, 31, 41) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(100), surface })
    const all = JSON.stringify(await ui.drawn({ in: 'dash-line' }))
    expect(all).toContain('78%')
    expect(all).toContain('31%')
    expect(all).toContain('41%')
    expect(await ui.find({ text: /^beneath$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('at 20% fuel or less the line is a pit call, and Handoff fills the prompt', async ($, on) => {
  let filled = ''
  engine(on, t => (filled = t))
  await $.session.measure(measure(166_000, 91, 77) as never)
  const ui = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await ui.find({ text: /PIT NOW/ })).toBeDefined()
  await ui.press({ key: 'dash-handoff' })
  expect(filled).toBe('/handoff ')
  await ui.unmount()
})

test('the panel draws gauges in the app and text rows in the terminal', async ($, on) => {
  engine(on)
  await $.session.measure(measure(44_000, 31, 41) as never)
  const app = await $.ui.mount({ ...pane(48), surface: 'desktop' })
  const svg = await app.find({ type: 'Svg' } as never)
  expect(String(svg?.props.alt)).toContain('Fuel 78%')
  await app.unmount()
  const term = await $.ui.mount({ ...pane(48), surface: 'terminal' })
  expect(await term.find({ text: /^Fuel$/ })).toBeDefined()
  expect(await term.find({ text: /^5-hour$/ })).toBeDefined()
  await term.unmount()
})

test('the cache warning takes over the line in its last two minutes, then it reads cold', async ($, on) => {
  engine(on)
  // A request of the main conversation that wrote hour-long cache entries starts the countdown.
  on('turn.step', async function* () {
    return { answer: '', toolUses: [], usage: { cache_creation: { ephemeral_1h_input_tokens: 500 } }, stopReason: 'end_turn' } as never
  })
  await $.session.measure(measure(92_000, 58, 52) as never)
  const step = $.turn.step({ model: 'claude-opus-5-5' } as never) as unknown as AsyncGenerator<unknown>
  for await (const _ of step) void _
  const ui = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn({ in: 'dash-line' }))).toContain('● 1:00:00')
  // 58:20 later: 1:40 left on the hour.
  await ui.advance(3_500_000)
  expect(JSON.stringify(await ui.drawn({ in: 'dash-line' }))).toContain('Send within 1:40, or the next message re-reads 92k tokens')
  await ui.advance(101_000)
  const after = JSON.stringify(await ui.drawn({ in: 'dash-line' }))
  expect(after).toContain('○ cold')
  expect(after).toContain('58%')
  await ui.unmount()
})

test('the panel reads the compact point from Claude Code and says so', async ($, on) => {
  engine(on)
  on('session.usage', () => ({ value: { context: { window: 1_000_000, tokens: 265_000, breakdown: { rawMaxTokens: 500_000 } }, rateLimits: [] } }) as never)
  await $.session.measure({ context: { window: 1_000_000, tokens: 265_000, percent: 27 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await $.ui.mount({ ...pane(48), surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' } as never)
  expect(String(svg?.props.alt)).toBe('Fuel 47%: 235k of 500k left before auto-compact')
  await ui.unmount()
})
