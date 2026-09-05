'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ConfirmInput = { title: string; description: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' };
type PendingConfirmation = ConfirmInput & { resolve(value: boolean): void };
type ConfirmContextValue = (input: ConfirmInput) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const settle = useCallback((value: boolean) => setPending((current) => {
    current?.resolve(value);
    return null;
  }), []);
  const confirm = useCallback((input: ConfirmInput) => new Promise<boolean>((resolve) => setPending({ ...input, resolve })), []);

  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') settle(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); };
  }, [pending, settle]);

  const value = useMemo(() => confirm, [confirm]);
  return <ConfirmContext.Provider value={value}>
    {children}
    {pending && <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <h2 id="confirm-title">{pending.title}</h2>
        <p id="confirm-description">{pending.description}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="secondary-button" type="button" onClick={() => settle(false)}>{pending.cancelLabel ?? 'Скасувати'}</button>
          <button className={pending.tone === 'danger' ? 'danger-button' : 'primary-button'} type="button" onClick={() => settle(true)}>{pending.confirmLabel ?? 'Підтвердити'}</button>
        </div>
      </section>
    </div>}
  </ConfirmContext.Provider>;
}

export function useConfirm(): ConfirmContextValue {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('useConfirm must be used inside ConfirmProvider');
  return value;
}
