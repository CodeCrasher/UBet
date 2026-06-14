import { useEffect, useRef } from 'preact/hooks';
import { flapChars } from '../lib/helpers.js';

// Split-flap counter. Each digit cell flips when its character changes.
// Reduced motion disables the flip via CSS (the value still updates).
export function FlipNumber({ value, prefix }) {
  const chars = flapChars(value);
  return (
    <span class="flap-row" role="text" aria-label={`${prefix || ''}${value}`}>
      {prefix ? <span class="flap-cur">{prefix}</span> : null}
      {chars.map((c, i) => <Flap key={chars.length - i} char={c} />)}
    </span>
  );
}

function Flap({ char }) {
  const ref = useRef(null);
  const prev = useRef(char);
  useEffect(() => {
    if (prev.current !== char && ref.current) {
      const el = ref.current;
      el.classList.remove('flipping');
      void el.offsetWidth; // restart animation
      el.classList.add('flipping');
      prev.current = char;
    }
  }, [char]);
  return <span class="flap" ref={ref}>{char}</span>;
}
