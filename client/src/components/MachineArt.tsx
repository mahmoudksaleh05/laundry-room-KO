import type { MachineState, MachineType } from '@suds/shared';
import { useId } from 'react';

const R = 45;
const C = 2 * Math.PI * R;

interface Props {
  type: MachineType;
  state: MachineState;
  /** 0..1 elapsed (running) or remaining (reserved) */
  progress?: number | null;
  /** short tag on a reserved machine (the owner's emoji) */
  tag?: string;
  urgent?: boolean;
  lcd?: string;
}

/** The front of a washer or dryer, drawn per state. Door centre is (60, 82). */
export function MachineArt({ type, state, progress, tag, urgent, lcd }: Props) {
  const id = useId().replace(/:/g, '');
  const running = state === 'RUNNING';
  const showArc = (state === 'RUNNING' || state === 'RESERVED') && progress != null;
  return (
    <svg
      className={`m ${type}${urgent ? ' urgent' : ''}`}
      data-s={state}
      viewBox="0 0 120 140"
      role="img"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`g${id}`} cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="var(--glass1)" />
          <stop offset="1" stopColor="var(--glass2)" />
        </radialGradient>
        <clipPath id={`c${id}`}>
          <circle cx="60" cy="82" r="31" />
        </clipPath>
      </defs>

      {/* cabinet */}
      <rect className="cab" x="6" y="6" width="108" height="128" rx="14" />
      <line className="seam" x1="6" y1="34" x2="114" y2="34" />
      {type === 'washer' ? (
        <rect className="drawer" x="14" y="13" width="26" height="13" rx="3" />
      ) : (
        <g>
          {[16, 22, 28, 34].map((x) => (
            <line key={x} className="vent" x1={x} y1="15" x2={x} y2="24" />
          ))}
        </g>
      )}
      <rect className="lcd" x="54" y="13" width="34" height="13" rx="3" />
      <text className="lcdt num" x="71" y="22.5" textAnchor="middle">
        {lcd ?? ''}
      </text>
      <circle className="dial-c" cx="101" cy="20" r="6" />
      <line className="dial-l" x1="101" y1="20" x2="101" y2="15.5" />
      <circle className="led" cx="46" cy="20" r="2.6" />

      {/* state ring */}
      {state === 'FREE' && (
        <>
          <circle className="glow" cx="60" cy="82" r="44" />
          <circle className="halo" cx="60" cy="82" r={R} />
        </>
      )}
      {showArc && (
        <>
          <circle className="track" cx="60" cy="82" r={R} />
          <circle
            className="arc"
            cx="60"
            cy="82"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress!)))}
          />
        </>
      )}
      {(state === 'RESERVED' || state === 'FINISHED') && <circle className="pulse" cx="60" cy="82" r={R} />}
      {state === 'OCCUPIED_UNKNOWN' && <circle className="dashed" cx="60" cy="82" r={R} />}

      {/* drum behind the glass */}
      <g clipPath={`url(#c${id})`}>
        <circle className="interior" cx="60" cy="82" r="31" />
        {running && type === 'washer' && (
          <g>
            <path className="water" d="M20 90 q8 -5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 V120 H20 Z" />
            {[50, 62, 70].map((x, i) => (
              <circle key={x} className="mb" cx={x} cy="104" r={1.6 + (i % 2)} style={{ animationDelay: `${i * 0.8}s` }} />
            ))}
          </g>
        )}
        {running && type === 'dryer' && <circle className="warm" cx="60" cy="82" r="31" />}
        {(running || state === 'OCCUPIED_UNKNOWN' || state === 'FINISHED') && (
          <g className={running ? 'drum' : undefined}>
            <ellipse cx="50" cy="94" rx="12" ry="6" fill="var(--accent)" opacity=".55" />
            <ellipse cx="67" cy="97" rx="11" ry="5" fill="var(--brass)" opacity=".6" />
            <ellipse cx="59" cy="89" rx="9" ry="4.5" fill="var(--art-fin)" opacity=".4" />
          </g>
        )}
      </g>

      {/* door */}
      <g className="door">
        <circle className="bezel" cx="60" cy="82" r="34.5" />
        <circle cx="60" cy="82" r="31" fill={`url(#g${id})`} opacity={running || state === 'OCCUPIED_UNKNOWN' || state === 'FINISHED' ? 0.28 : 0.9} />
        <path className="reflect" d="M41 70 a24 24 0 0 1 14 -13" />
        <rect className="brass" x="94" y="76" width="5" height="12" rx="2.5" />
      </g>

      {state === 'FINISHED' && (
        <g className="ding">
          <rect x="38" y="40" width="44" height="17" rx="8.5" />
          <text x="60" y="52" textAnchor="middle">
            DONE
          </text>
        </g>
      )}
      {state === 'RESERVED' && tag && (
        <g className="qtag">
          <line x1="98" y1="34" x2="98" y2="40" />
          <rect x="86" y="40" width="24" height="20" rx="6" />
          <text x="98" y="54.5" textAnchor="middle">
            {tag}
          </text>
        </g>
      )}
      {state === 'OUT_OF_ORDER' && (
        <g className="tape" transform="rotate(-18 60 82)">
          <rect x="-4" y="72" width="128" height="18" />
          <text x="60" y="85" textAnchor="middle">
            OUT OF ORDER
          </text>
        </g>
      )}
    </svg>
  );
}
