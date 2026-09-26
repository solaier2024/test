import { CYLINDER_SIZE } from '../game/types'

interface CylinderProps {
  /** Live rounds being loaded, only meaningful while the cylinder is open. */
  live: number
  /** Chambers already fired this round. */
  fired: number
  /** Live rounds still unaccounted for. */
  liveLeft: number
  /**
   * 'open' shows exactly which chambers take a round while you load them.
   * 'sealed' hides the order, which is the whole tension of the round.
   */
  mode: 'open' | 'sealed'
  spinning: boolean
  size?: number
}

/** Top-down cylinder readout. The count is public; the order never is. */
export function Cylinder({
  live,
  fired,
  liveLeft,
  mode,
  spinning,
  size = 132,
}: CylinderProps) {
  const r = size / 2
  const chamberR = size * 0.115
  const orbit = size * 0.29
  const remaining = CYLINDER_SIZE - fired
  const blanksLeft = Math.max(0, remaining - liveLeft)

  return (
    <div className="cylinder">
      <svg
        className={spinning ? 'cylinder__disc cylinder__disc--spin' : 'cylinder__disc'}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <defs>
          <radialGradient id="cyl-steel" cx="35%" cy="28%">
            <stop offset="0%" stopColor="#6e6458" />
            <stop offset="60%" stopColor="#3a342d" />
            <stop offset="100%" stopColor="#17140f" />
          </radialGradient>
          <radialGradient id="cyl-brass" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#f2d488" />
            <stop offset="70%" stopColor="#b3842f" />
            <stop offset="100%" stopColor="#6b4c15" />
          </radialGradient>
        </defs>
        <circle cx={r} cy={r} r={r - 2} fill="url(#cyl-steel)" stroke="#0d0b08" strokeWidth="2" />
        <circle cx={r} cy={r} r={r * 0.17} fill="#120f0b" stroke="#4a4239" strokeWidth="1" />
        {Array.from({ length: CYLINDER_SIZE }).map((_, i) => {
          const angle = (i / CYLINDER_SIZE) * Math.PI * 2 - Math.PI / 2
          const cx = r + Math.cos(angle) * orbit
          const cy = r + Math.sin(angle) * orbit
          const spent = mode === 'sealed' && i < fired
          const showsBrass = mode === 'open' && i < live

          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r={chamberR}
                fill="#0a0806"
                stroke={spent ? '#332c24' : '#5c5144'}
                strokeWidth="1.2"
              />
              {showsBrass && <circle cx={cx} cy={cy} r={chamberR * 0.72} fill="url(#cyl-brass)" />}
              {mode === 'sealed' && !spent && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={chamberR * 0.72}
                  fill="#241d15"
                  stroke="#6a5c49"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}
              {spent && (
                <g stroke="#463c31" strokeWidth="1.4" strokeLinecap="round">
                  <line x1={cx - chamberR * 0.4} y1={cy - chamberR * 0.4} x2={cx + chamberR * 0.4} y2={cy + chamberR * 0.4} />
                  <line x1={cx + chamberR * 0.4} y1={cy - chamberR * 0.4} x2={cx - chamberR * 0.4} y2={cy + chamberR * 0.4} />
                </g>
              )}
            </g>
          )
        })}
      </svg>
      <div className="cylinder__caption">
        <span className="cylinder__live">{mode === 'open' ? live : liveLeft} 实弹</span>
        <span className="cylinder__blank">
          {mode === 'open' ? CYLINDER_SIZE - live : blanksLeft} 空仓
        </span>
      </div>
    </div>
  )
}
