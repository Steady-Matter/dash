// The side panel's drawings: a dial for each limit and the fuel bar, each on its own dark tile
// so they read as a dash in a light theme too.
import { toneHex, usedTone, fuelTone } from './core'

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const TILE = '#0d0f12'
const TRACK = '#262a31'
const TICK = '#5d6570'
const LABEL = '#a9b0bb'
const NEEDLE = '#ff7a1a'
const GHOST = '#7cc4ff'

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// The dial sweeps 252 degrees from lower left to lower right; 110% sits at the end so a
// projection past 100 still has room.
const A0 = Math.PI * 0.8
const A1 = Math.PI * 2.2
const ang = (p: number) => A0 + ((A1 - A0) * Math.max(0, Math.min(p, 110))) / 110
const pt = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = pt(cx, cy, r, a0)
  const [x1, y1] = pt(cx, cy, r, a1)
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

/**
 * One limit's dial: the needle at `pct`, a dashed ghost needle where the pace ends (`ghost`),
 * the red zone from 80, and the label under the number.
 */
export const gaugeSvg = (pct: number, title: string, sub: string, ghost: number | null) => {
  const cx = 110
  const cy = 100
  const r = 78
  const color = toneHex(usedTone(pct))
  const parts: string[] = []
  parts.push(`<rect width="220" height="200" rx="16" fill="${TILE}"/>`)
  parts.push(`<path d="${arc(cx, cy, r, A0, A1)}" stroke="${TRACK}" stroke-width="10" fill="none"/>`)
  parts.push(`<path d="${arc(cx, cy, r, ang(80), ang(100))}" stroke="#5a1a1c" stroke-width="10" fill="none"/>`)
  parts.push(`<path d="${arc(cx, cy, r, ang(100), A1)}" stroke="#3a0f10" stroke-width="10" fill="none"/>`)
  if (pct > 0) parts.push(`<path d="${arc(cx, cy, r, A0, ang(pct))}" stroke="${color}" stroke-width="10" fill="none" opacity=".9"/>`)
  for (let t = 0; t <= 100; t += 10) {
    const a = ang(t)
    const big = t % 50 === 0
    const [x1, y1] = pt(cx, cy, r - 10, a)
    const [x2, y2] = pt(cx, cy, r - (big ? 22 : 16), a)
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${t >= 80 ? '#ff6a6a' : TICK}" stroke-width="${big ? 2.4 : 1.4}"/>`)
    if (big && t > 0) {
      const [tx, ty] = pt(cx, cy, r - 34, a)
      parts.push(`<text x="${tx.toFixed(1)}" y="${(ty + 5).toFixed(1)}" fill="${LABEL}" font-family="${FONT}" font-size="14" text-anchor="middle">${t}</text>`)
    }
  }
  if (ghost !== null) {
    const [gx, gy] = pt(cx, cy, r - 6, ang(ghost))
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${gx.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${GHOST}" stroke-width="2.4" stroke-dasharray="3 4" opacity=".85"/>`)
  }
  const a = ang(pct)
  const [bx, by] = pt(cx, cy, -12, a)
  const [nx, ny] = pt(cx, cy, r - 4, a)
  parts.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${NEEDLE}" stroke-width="3.6" stroke-linecap="round"/>`)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="#1d2127" stroke="#3a404a"/>`)
  parts.push(`<text x="${cx}" y="${cy + 46}" fill="#eef1f5" font-family="${FONT}" font-weight="600" font-size="34" text-anchor="middle">${Math.round(pct)}%</text>`)
  parts.push(`<text x="${cx}" y="${cy + 66}" fill="${LABEL}" font-family="${FONT}" font-size="15" text-anchor="middle">${xml(sub)}</text>`)
  parts.push(`<text x="${cx}" y="${cy + 90}" fill="${LABEL}" font-family="${FONT}" font-size="14" font-weight="600" letter-spacing="2" text-anchor="middle">${xml(title.toUpperCase())}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="200" viewBox="0 0 220 200">${parts.join('')}</svg>`
}

/** The fuel tile: ten slanted cells, the percent left, and the tokens left under it. */
export const fuelSvg = (fuel: number, sub: string) => {
  const width = 360
  const h = 74
  const color = toneHex(fuelTone(fuel))
  const cells = 10
  const cw = 18
  const gap = 4
  const barW = cells * cw + (cells - 1) * gap
  const x0 = Math.round((width - barW - 110) / 2) + 52
  const lit = Math.round((cells * fuel) / 100)
  const segs = Array.from({ length: cells }, (_, i) => {
    const x = x0 + i * (cw + gap)
    return `<path d="M${x + 5} 14 h${cw} l-5 24 h-${cw} z" fill="${i < lit ? color : TRACK}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
<rect width="${width}" height="${h}" rx="14" fill="${TILE}"/>
<text x="${x0 - 12}" y="32" fill="${LABEL}" font-family="${FONT}" font-size="13" font-weight="600" letter-spacing="2" text-anchor="end">FUEL</text>
${segs}
<text x="${x0 + barW + 10}" y="33" fill="${color}" font-family="${FONT}" font-size="20" font-weight="600">${fuel}%</text>
<text x="${width / 2}" y="60" fill="${LABEL}" font-family="${FONT}" font-size="13" text-anchor="middle">${xml(sub)}</text>
</svg>`
}
