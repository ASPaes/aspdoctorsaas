import { useState, useEffect } from 'react';

export function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { setOpen(false); };
    setTimeout(() => window.addEventListener('click', handler), 0);
    return () => window.removeEventListener('click', handler);
  }, [open]);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '0.5px solid var(--color-border-secondary)',
          background: 'transparent',
          fontSize: 10,
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
        aria-label="Ajuda"
      >
        ?
      </button>
      {open && (
        <span
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 260,
            padding: 10,
            background: '#1e293b',
            color: '#f1f5f9',
            fontSize: 11,
            lineHeight: 1.5,
            borderRadius: 8,
            zIndex: 50,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
