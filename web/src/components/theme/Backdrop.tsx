import type { CSSProperties } from 'react'

/*
 * Quiet faceted backdrop: low-contrast panels with thin gold hairlines, drawn as SVG so
 * every colour comes from theme tokens (--bg-*, see index.css) and follows light/dark.
 * A soft wash over the centre keeps the pattern to the edges, away from the content.
 * Fixed behind the whole app; `slice` keeps it filling any window shape.
 */

const fill = (v: string): CSSProperties => ({ fill: `var(${v})` })

/** A gold hairline: a thin quad so it can taper from `w0` to `w1` along its length. */
function Seam({ x1, y1, x2, y2, w0, w1 }: { x1: number; y1: number; x2: number; y2: number; w0: number; w1: number }) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const nx = -(y2 - y1) / len
  const ny = (x2 - x1) / len
  const pts = [
    [x1 + (nx * w0) / 2, y1 + (ny * w0) / 2],
    [x2 + (nx * w1) / 2, y2 + (ny * w1) / 2],
    [x2 - (nx * w1) / 2, y2 - (ny * w1) / 2],
    [x1 - (nx * w0) / 2, y1 - (ny * w0) / 2],
  ]
  return <polygon points={pts.map((p) => p.join(',')).join(' ')} style={fill('--bg-line')} />
}

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 print:hidden">
      <svg className="size-full" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="bd-wash" cx="0.5" cy="0.5" r="0.62">
            <stop offset="0.35" style={{ stopColor: 'var(--bg-wash)', stopOpacity: 'var(--bg-wash-opacity)' }} />
            <stop offset="1" style={{ stopColor: 'var(--bg-wash)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        {/* Panels, back to front. */}
        <rect width="1600" height="1000" style={fill('--bg-facet-3')} />
        <polygon points="0,1000 0,700 820,800 760,1000" style={fill('--bg-facet-4')} />
        <polygon points="250,600 1010,40 1180,230 520,720" style={fill('--bg-facet-2')} />
        <polygon points="1190,480 1345,450 1600,215 1600,720 1230,870" style={fill('--bg-facet-2')} />
        <polygon points="1130,0 1600,0 1600,215 1345,450" style={fill('--bg-facet-1')} />
        <polygon points="0,280 1000,0 830,100 0,560" style={fill('--bg-facet-2')} />
        <polygon points="0,0 1000,0 0,280" style={fill('--bg-facet-1')} />
        <polygon points="880,1000 1600,710 1600,1000" style={fill('--bg-facet-1')} />

        {/* Gold hairlines. */}
        <g style={{ opacity: 'var(--bg-line-opacity)' }}>
          <Seam x1={0} y1={280} x2={1000} y2={0} w0={3} w1={1.5} />
          <Seam x1={0} y1={560} x2={830} y2={100} w0={3} w1={0.5} />
          <Seam x1={1130} y1={0} x2={1345} y2={450} w0={2.5} w1={0.5} />
          <Seam x1={750} y1={1000} x2={1190} y2={480} w0={2} w1={0.5} />
          <Seam x1={1600} y1={215} x2={1230} y2={870} w0={2.5} w1={1} />
          <Seam x1={880} y1={1000} x2={1600} y2={710} w0={2} w1={2.5} />
        </g>

        {/* Calm centre where the content sits. */}
        <rect width="1600" height="1000" fill="url(#bd-wash)" />
      </svg>
    </div>
  )
}
