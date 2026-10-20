import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Reading } from '../types'
import {
  C,
  D7,
  DEFAULT_CACHE,
  H5,
  PIT_AT,
  WARN_MS,
  bar,
  cacheTtlOf,
  fiveHourWords,
  fmtClock,
  fmtSpan,
  fuelCap,
  fuelOf,
  fuelTone,
  kTokens,
  limitOf,
  normalizeCache,
  paceOf,
  toneKey,
  usedTone,
  weeklyWords,
} from './core'
import { fuelSvg, gaugeSvg } from './gauge'

const PANE = 'dash'
const TITLE = 'Dash'
const PANE_COLUMNS = 48
const HANDOFF = '/handoff '

// ---------------------------------------------------------------- state

const reading = atom({ plugin: 'dash', key: 'reading' } as const, null)
const cache = atom({ plugin: 'dash', key: 'cache' } as const, DEFAULT_CACHE)

const getCache = async ($: EngineInterface) => normalizeCache(await read($, cache))

const readingOf = (
  u: { context: { tokens?: number; window: number }; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] },
  ctxLimit: number | null,
): Reading => ({
  ctxTokens: u.context.tokens ?? null,
  ctxWindow: u.context.window,
  ctxLimit,
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
})

/**
 * From the summary breakdown, which is counted on this machine so asking sends nothing: `limit`,
 * the context the conversation can fill before Claude Code compacts it (the auto-compact point
 * when one is set below the model's window, else the window), and `estimate`, the tokens already
 * in it. The estimate stands in for fuel until the first reply reports the real count.
 */
async function contextPlan($: EngineInterface): Promise<{ limit: number | null; estimate: number | null }> {
  const b = (await $.session.usage({ breakdown: 'summary' }).catch(() => null))?.context.breakdown
  return { limit: b?.rawMaxTokens ?? null, estimate: b?.totalTokens ?? null }
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 10 })
}

/** Everything both drawings need, worked out once from the stored readings. */
async function gauges($: EngineInterface) {
  const [r, c, now] = await Promise.all([read($, reading), getCache($), $.clock.now()])
  const fuel = fuelOf(r)
  const h5l = limitOf(r, 'five_hour')
  const wkl = limitOf(r, 'seven_day')
  const h5 = h5l ? paceOf(h5l, H5, now) : null
  const wk = wkl ? paceOf(wkl, D7, now) : null
  return {
    r,
    now,
    fuel,
    h5,
    wk,
    h5w: h5 ? fiveHourWords(h5) : null,
    wkw: wk ? weeklyWords(wk) : null,
    expiresAt: c.lastRequestAt > 0 ? c.lastRequestAt + c.ttlMs : 0,
    ttlMs: c.ttlMs,
    reread: r?.ctxTokens ? `${kTokens(r.ctxTokens)} tokens` : 'the whole conversation',
    isPit: fuel !== null && fuel <= PIT_AT,
  }
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dash', description: 'Dash: open or close the gauges panel', argumentHint: '[open|close]' })
    const [u, plan] = await Promise.all([$.session.usage().catch(() => null), contextPlan($)])
    if (u) {
      const tokens = u.context.tokens ?? plan.estimate ?? undefined
      await update($, reading, () => readingOf({ ...u, context: { ...u.context, tokens } }, plan.limit))
    }
    // The app gets the panel from the start; the terminal opens it on /dash.
    if (e.surface !== 'terminal' && (await $.session.surfaces()).length > 0) void openPane($).catch(() => undefined)
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface !== 'terminal') void openPane($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, reading, () => null)
      await update($, cache, () => DEFAULT_CACHE)
    }
    return next(e)
  })

  on('command.run', { command: 'dash' }, async ($, e) => {
    if (e.args.trim().split(/\s+/)[0] === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Dash closed.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Dash opened.' : `Dash is not shown yet: ${opened.reason}` }
  })

  // Every new usage figure: the context fill, a limit moving a point.
  on('session.measure', async ($, e, next) => {
    // The compact point is read again only when it is unknown or the model's window changed.
    const prev = await read($, reading)
    const limit = prev && prev.ctxLimit && prev.ctxWindow === e.context.window ? prev.ctxLimit : (await contextPlan($)).limit
    // A reading with no count yet keeps the start-up estimate.
    const tokens = e.context.tokens ?? prev?.ctxTokens ?? undefined
    await update($, reading, () => readingOf({ ...e, context: { ...e.context, tokens } }, limit))
    return next(e)
  })

  // Each request of the main conversation renews the prompt cache: the countdown starts here.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => {
        const x = normalizeCache(c)
        return { lastRequestAt: now, ttlMs: cacheTtlOf(result.usage, x.ttlMs) }
      })
    }
    return result
  })

  // ---------------------------------------------------------------- the line above the prompt

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const g = await gauges($)
    if (g.fuel === null && !g.h5 && !g.wk && g.expiresAt === 0) return next(e)
    // Another mod's band (the radio, Spotter's bar) keeps its row under this one.
    const beneath = await next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const cols = e.props.bodyColumns || 80
    const fb = g.fuel !== null ? bar(g.fuel, cols >= 90 ? 8 : 5) : { full: '', empty: '' }
    const fuelColor = g.fuel !== null ? toneKey(fuelTone(g.fuel)) : C.dim

    // Pit call: the whole line is the call, with the handoff one press away.
    if (g.isPit && g.fuel !== null) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text wrap="truncate">
              <Text color={C.dim}>{'FUEL '}</Text>
              <Text color={C.bad}>{fb.full}</Text>
              <Text color={C.faint}>{fb.empty}</Text>
              <Text color={C.bad} bold>{` ${g.fuel}%`}</Text>
              <Text color={C.faint}>{' │ '}</Text>
              <Text color={C.bad} bold>{'■ PIT NOW '}</Text>
              <Text>{'write the handoff, then start fresh'}</Text>
            </Text>
            <Button key="dash-handoff" label="Handoff" onPress={() => void $.prompt.fill({ text: HANDOFF })} />
          </Box>
          {beneath}
        </Box>
      )
    }

    const seg = (p: typeof g.h5, w: typeof g.h5w) =>
      p && w ? { pct: p.pct, color: toneKey(usedTone(p.pct)), words: w.short, wordsColor: w.tone === 'bad' ? C.bad : C.dim } : null
    const props = {
      fuel: g.fuel,
      fuelColor,
      fuelFull: fb.full,
      fuelEmpty: fb.empty,
      h5: seg(g.h5, g.h5w),
      wk: seg(g.wk, g.wkw),
      expiresAt: g.expiresAt,
      now: g.now,
      reread: g.reread,
      warnMs: WARN_MS,
    }
    const line =
      'Client' in els ? (
        <els.Client key="dash-line" module="./line.tsx" props={props} />
      ) : (
        // A surface with no client modules: a fixed reading, redrawn with the next update.
        <Text wrap="truncate">
          {g.fuel !== null ? <Text color={fuelColor}>{`FUEL ${fb.full}${fb.empty} ${g.fuel}%`}</Text> : null}
          {props.h5 ? <Text color={C.dim}>{` │ 5h ${Math.round(props.h5.pct)}% ${props.h5.words}`}</Text> : null}
          {props.wk ? <Text color={C.dim}>{` │ wk ${Math.round(props.wk.pct)}% ${props.wk.words}`}</Text> : null}
          {g.expiresAt > 0 ? <Text color={C.dim}>{g.expiresAt > g.now ? ` │ ● ${fmtClock(g.expiresAt - g.now)}` : ' │ ○ cold'}</Text> : null}
        </Text>
      )
    return (
      <Box flexDirection="column">
        {line}
        {beneath}
      </Box>
    )
  })

  // ---------------------------------------------------------------- the side panel

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const g = await gauges($)
    const W = Math.max(32, e.props.bodyColumns)
    const hasSvg = e.surface !== 'terminal' && 'Svg' in els
    const hasClient = 'Client' in els
    const tank = g.r ? fuelCap(g.r) : 0
    const tokensLeft =
      g.r && g.r.ctxTokens !== null
        ? `${kTokens(Math.max(0, tank - g.r.ctxTokens))} of ${kTokens(tank)} left${tank < g.r.ctxWindow ? ' before auto-compact' : ' tokens'}`
        : ''

    const cacheBlock =
      g.expiresAt === 0 ? (
        <Text color={C.faint} wrap="wrap">The cache countdown starts with Claude's first reply.</Text>
      ) : hasClient ? (
        <els.Client key="dash-cache" module="./cache.tsx" props={{ expiresAt: g.expiresAt, now: g.now, ttlMs: g.ttlMs, reread: g.reread, warnMs: WARN_MS }} />
      ) : (
        <Text color={C.dim}>{g.expiresAt > g.now ? `Cache ● ${fmtClock(g.expiresAt - g.now)}` : `Cache ○ cold · next message re-reads ${g.reread}`}</Text>
      )

    const pit = g.isPit ? (
      <Box flexDirection="column" borderStyle="round" borderColor={C.bad} paddingX={1}>
        <Text wrap="wrap">
          <Text color={C.bad} bold>{'Pit now. '}</Text>
          {`Fuel is down to ${g.fuel}%.${g.h5w && g.h5?.wallIn !== null ? ` The 5-hour wall is ~${g.h5w.short.replace('wall in ', '')} out.` : ''} Write the handoff, then start a fresh session.`}
        </Text>
        <Button key="dash-pit" label="Write handoff" onPress={() => void $.prompt.fill({ text: HANDOFF })} />
      </Box>
    ) : null

    if (hasSvg) {
      // No width on the drawings: each takes its own width up to its slot and scales down to fit,
      // so the panel's real width (which the column count only estimates) never clips them.
      const paceText = (w: { long: string; tone: string } | null) =>
        w && w.long ? (
          <Text color={w.tone === 'bad' ? C.bad : w.tone === 'amber' ? C.amber : C.dim} size="footnote" wrap="wrap">
            {w.long}
          </Text>
        ) : null
      const dialBox = (svg: RenderChildren, words: RenderChildren) => (
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} alignItems="center" gap={1}>
          {svg}
          {words}
        </Box>
      )
      return (
        <Box flexDirection="column" width={W} gap={2} paddingX={1} paddingY={1}>
          {cacheBlock}
          {g.fuel !== null ? <els.Svg source={fuelSvg(g.fuel, tokensLeft)} alt={`Fuel ${g.fuel}%: ${tokensLeft}`} /> : null}
          {g.h5 || g.wk ? (
            <Box flexDirection="row" gap={2}>
              {g.h5
                ? dialBox(
                    <els.Svg source={gaugeSvg(g.h5.pct, '5-hour', g.h5.resetsIn !== null ? `resets in ${fmtSpan(g.h5.resetsIn)}` : '', null)} alt={`5-hour limit ${Math.round(g.h5.pct)}% used`} />,
                    paceText(g.h5w),
                  )
                : null}
              {g.wk
                ? dialBox(
                    <els.Svg source={gaugeSvg(g.wk.pct, 'Weekly', g.wk.resetsIn !== null ? `resets in ${fmtSpan(g.wk.resetsIn)}` : '', g.wk.projected)} alt={`Weekly limit ${Math.round(g.wk.pct)}% used${g.wk.projected !== null ? `, on pace for ${g.wk.projected}%` : ''}`} />,
                    paceText(g.wkw),
                  )
                : null}
            </Box>
          ) : (
            <Text color={C.faint} wrap="wrap">The limit gauges appear once Claude reports them (subscription plans only).</Text>
          )}
          {g.wk?.projected !== null && g.wk ? (
            <Text color={C.faint} size="caption" wrap="wrap">{'Orange needle: now. Dashed blue: where this pace ends the week.'}</Text>
          ) : null}
          {pit}
        </Box>
      )
    }

    // The terminal: the same readings as rows of text.
    const row = (label: string, value: RenderChildren) => (
      <Box>
        <Box width={9} flexShrink={0}>
          <Text color={C.dim}>{label}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {value}
        </Box>
      </Box>
    )
    const meter = (pct: number, color: string, words: string) => {
      const b = bar(pct, 10)
      return (
        <Text wrap="truncate">
          <Text color={color}>{b.full}</Text>
          <Text color={C.faint}>{b.empty}</Text>
          <Text bold>{` ${Math.round(pct)}%`}</Text>
          {words ? <Text color={C.dim}>{` ${words}`}</Text> : null}
        </Text>
      )
    }
    return (
      <Box flexDirection="column" width={W}>
        {cacheBlock}
        {g.fuel !== null ? row('Fuel', meter(g.fuel, toneKey(fuelTone(g.fuel)), tokensLeft)) : null}
        {g.h5 && g.h5w ? row('5-hour', meter(g.h5.pct, toneKey(usedTone(g.h5.pct)), g.h5w.short)) : null}
        {g.wk && g.wkw ? row('Weekly', meter(g.wk.pct, toneKey(usedTone(g.wk.pct)), g.wkw.long)) : null}
        {pit}
      </Box>
    )
  })
}
