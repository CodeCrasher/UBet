// Live, lightweight landing backdrop: faint pitch markings + soccer balls that
// drift slowly upward. Pure CSS transforms (GPU-friendly), no JS animation loop;
// respects prefers-reduced-motion (balls settle off-screen).

// Build a recognisable stylised soccer ball as an inline SVG once.
function pentagon(cx, cy, r, rotDeg) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const a = ((rotDeg + i * 72) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function Ball() {
  const cx = 50;
  const cy = 50;
  const seams = [];
  const outer = [];
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    const vx = cx + 14 * Math.cos(a);
    const vy = cy + 14 * Math.sin(a);
    const rx = cx + 46 * Math.cos(a);
    const ry = cy + 46 * Math.sin(a);
    seams.push(<path key={`s${i}`} d={`M${vx.toFixed(1)} ${vy.toFixed(1)} L${rx.toFixed(1)} ${ry.toFixed(1)}`} />);
    outer.push(<polygon key={`o${i}`} points={pentagon(rx, ry, 7, -90 + i * 72 + 180)} fill="#16302a" />);
  }
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="#ffffff" stroke="#16302a" stroke-width="3" />
      <polygon points={pentagon(cx, cy, 14, -90)} fill="#16302a" />
      <g stroke="#16302a" stroke-width="3" fill="none" stroke-linecap="round">{seams}</g>
      {outer}
    </svg>
  );
}

// Varied, deterministic ball field — position, size, speed, drift, spin, depth.
const BALLS = [
  { left: '6%', size: 50, dur: 26, delay: 0, sway: '34px', spin: '320deg', op: 0.22, blur: 0 },
  { left: '20%', size: 30, dur: 33, delay: 7, sway: '-44px', spin: '-380deg', op: 0.14, blur: 1.5 },
  { left: '38%', size: 70, dur: 22, delay: 3, sway: '26px', spin: '420deg', op: 0.1, blur: 2.5 },
  { left: '55%', size: 36, dur: 30, delay: 11, sway: '-30px', spin: '-300deg', op: 0.22, blur: 0 },
  { left: '70%', size: 56, dur: 24, delay: 1.5, sway: '40px', spin: '360deg', op: 0.15, blur: 1.5 },
  { left: '85%', size: 26, dur: 35, delay: 9, sway: '-24px', spin: '-440deg', op: 0.2, blur: 0 },
  { left: '48%', size: 42, dur: 28, delay: 15, sway: '44px', spin: '300deg', op: 0.12, blur: 2 },
  { left: '14%', size: 38, dur: 31, delay: 19, sway: '-36px', spin: '-340deg', op: 0.18, blur: 0 },
];

export function PitchBackground() {
  return (
    <div class="pitch-bg" aria-hidden="true">
      <svg class="pitch-lines" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
        <g fill="none" stroke="var(--pitch-400)" stroke-width="2.5">
          <circle cx="300" cy="300" r="285" />
          <circle cx="300" cy="300" r="92" class="pitch-circle" />
          <line x1="15" y1="300" x2="585" y2="300" />
          <circle cx="300" cy="300" r="5" fill="var(--pitch-400)" stroke="none" />
        </g>
      </svg>
      {BALLS.map((b, i) => (
        <span
          key={i}
          class="fb"
          style={{
            left: b.left,
            width: `${b.size}px`,
            height: `${b.size}px`,
            filter: b.blur ? `blur(${b.blur}px)` : 'none',
            '--dur': `${b.dur}s`,
            '--delay': `${b.delay}s`,
            '--sway': b.sway,
            '--spin': b.spin,
            '--op': b.op,
          }}
        >
          <Ball />
        </span>
      ))}
    </div>
  );
}
