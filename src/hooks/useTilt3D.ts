import { useEffect, useRef, RefObject } from 'react';

interface UseTilt3DOptions {
  maxDeg?: number;
  enabled?: boolean;
}

/**
 * Tilt 3D + spotlight tracking via requestAnimationFrame.
 * Define CSS vars no elemento: --rx, --ry, --mx, --my.
 * Skip automático em touch devices e prefers-reduced-motion.
 */
export function useTilt3D<T extends HTMLElement>(
  ref: RefObject<T>,
  { maxDeg = 5, enabled = true }: UseTilt3DOptions = {}
) {
  const rafIdRef = useRef<number | null>(null);
  const pendingEventRef = useRef<MouseEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    if (typeof window === 'undefined') return;
    if (window.matchMedia('(hover: none)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const handleMove = (e: MouseEvent) => {
      pendingEventRef.current = e;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        const ev = pendingEventRef.current;
        if (!ev) { rafIdRef.current = null; return; }
        const rect = el.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ry = ((x - cx) / cx) * maxDeg;
        const rx = -((y - cy) / cy) * maxDeg;
        el.style.setProperty('--rx', `${rx}deg`);
        el.style.setProperty('--ry', `${ry}deg`);
        el.style.setProperty('--mx', `${x}px`);
        el.style.setProperty('--my', `${y}px`);
        rafIdRef.current = null;
        pendingEventRef.current = null;
      });
    };

    const handleLeave = () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);

    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [ref, maxDeg, enabled]);
}
