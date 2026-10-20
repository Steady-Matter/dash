// The side panel's cache: five shift lights that go out as the hour runs down, a big countdown,
// and what the next message costs. Ticks on the surface's own clock.
import type { ClientModule } from 'claude-code'

type Props = { expiresAt: number; now: number; ttlMs: number; reread: string; warnMs: number }
type Ref = { left: number; lastNow: number; blink: boolean }
type State = { ref: Ref }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}

const Cache: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { left: 0, lastNow: -1, blink: false }
  if (props.now !== ref.lastNow) {
    ref.lastNow = props.now
    ref.left = props.expiresAt - props.now
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      if (ref.left > 0) {
        ref.left -= 1000
        ref.blink = !ref.blink
        surface.setState({ ref })
      }
    })
  }
  const isCold = ref.left <= 0
  const isWarn = !isCold && ref.left <= props.warnMs
  const color = isCold ? 'suggestion' : isWarn ? 'error' : ref.left <= 600_000 ? 'warning' : 'success'
  const lit = isCold ? 0 : Math.max(1, Math.ceil((5 * ref.left) / props.ttlMs))
  // Under the warning the lit lights blink once a second.
  const lights = Array.from({ length: 5 }, (_, i) => (i < lit && !(isWarn && ref.blink) ? '●' : '○')).join(' ')
  const sub = isCold ? `Cold. The next message re-reads ${props.reread}` : isWarn ? 'Send soon or it goes cold' : 'Warm. The next message is cheap'
  return (
    <Box flexDirection="column" alignItems="center">
      <Text color="inactive" size="caption" weight="semibold">CACHE</Text>
      <Text color={litColor(color, lit)}>{lights}</Text>
      <Text size="title" weight="semibold" tabular color={isCold ? 'suggestion' : isWarn ? 'error' : 'text'}>
        {isCold ? 'COLD' : fmt(ref.left)}
      </Text>
      <Text color="inactive" size="footnote" wrap="wrap">{sub}</Text>
    </Box>
  )
}

// All five out reads as cold, not as the warning colour.
const litColor = (color: string, lit: number) => (lit === 0 ? 'subtle' : color)

export default Cache
