// The line above the prompt, ticking so the cache countdown stays right while nothing else redraws.
// Its readings come from the hooks module; it only counts the cache down, from the real clock: the
// app rebuilds this widget from its last props when the chat is reopened, and that time may be old.
import type { ClientModule } from 'claude-code'

type Seg = { pct: number; color: string; words: string; wordsColor: string }
type Props = {
  fuel: number | null
  fuelColor: string
  fuelFull: string
  fuelEmpty: string
  h5: Seg | null
  wk: Seg | null
  /** When the cache goes cold; 0 before the first request. */
  expiresAt: number
  /** What a cold cache re-reads, as words: "92k tokens". */
  reread: string
  warnMs: number
}
type Ref = { mountedAt: number; ticks: number }
type State = { ref: Ref }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}

const Line: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { mountedAt: Date.now(), ticks: 0 }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(1000, () => {
      ref.ticks += 1
      surface.setState({ ref })
    })
  }
  // The later of the real clock and the frame clock (which the tests move).
  const left = props.expiresAt > 0 ? props.expiresAt - Math.max(Date.now(), ref.mountedAt + ref.ticks * 1000) : 0
  const sep = <Text color="subtle">{' │ '}</Text>
  const fuel =
    props.fuel === null ? null : (
      <Text wrap="truncate">
        <Text color="inactive">{'FUEL '}</Text>
        <Text color={props.fuelColor}>{props.fuelFull}</Text>
        <Text color="subtle">{props.fuelEmpty}</Text>
        <Text color={props.fuelColor} bold>{` ${props.fuel}%`}</Text>
      </Text>
    )
  const hasCache = props.expiresAt > 0
  const isWarn = hasCache && left > 0 && left <= props.warnMs
  // The cache is about to go cold: the middle of the line becomes the warning.
  if (isWarn) {
    return (
      <Box flexDirection="row">
        {fuel}
        {fuel ? sep : null}
        <Text color="warning" wrap="truncate">{`▲ Send within ${fmt(left)}, or the next message re-reads ${props.reread}`}</Text>
      </Box>
    )
  }
  const seg = (label: string, s: Seg | null) =>
    s === null ? null : (
      <Text wrap="truncate">
        <Text color="inactive">{`${label} `}</Text>
        <Text color={s.color} bold>{`${Math.round(s.pct)}%`}</Text>
        {s.words ? <Text color={s.wordsColor}>{` ${s.words}`}</Text> : null}
      </Text>
    )
  const cacheColor = !hasCache ? 'subtle' : left <= 0 ? 'suggestion' : left <= 600_000 ? 'warning' : 'success'
  const cache = hasCache ? <Text color={cacheColor}>{left > 0 ? `● ${fmt(left)}` : '○ cold'}</Text> : null
  const items = [fuel, seg('5h', props.h5), seg('wk', props.wk), cache].filter(x => x !== null)
  return (
    <Box flexDirection="row">
      {items.flatMap((x, i) => (i === 0 ? [x] : [sep, x]))}
    </Box>
  )
}

export default Line
