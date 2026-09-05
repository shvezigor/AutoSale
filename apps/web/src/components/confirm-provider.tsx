'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useModalFocus } from './use-modal-focus';

type ConfirmInput = { title: string; description: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' };
type PendingConfirmation = ConfirmInput & { resolve(value: boolean): void };
type ConfirmContextValue = (input: ConfirmInput) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current; resolver.current = null;
    setPending(null); resolve?.(value);
  }, []);
  const confirm = useCallback((input: ConfirmInput) => new Promise<boolean>((resolve) => {
    if (resolver.current) { resolve(false); return; }
    resolver.current = resolve; setPending({ ...input, resolve });
  }), []);
  const cancel = useCallback(() => settle(false), [settle]);
  useModalFocus(Boolean(pending), dialog, cancel);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);

  const value = useMemo(() => confirm, [confirm]);
  return <ConfirmContext.Provider value={value}>
    <div style={{ display: 'contents' }} inert={Boolean(pending)}>{children}</div>
    {pending && <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}>
      <section ref={dialog} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <h2 id="confirm-title">{pending.title}</h2>
        <p id="confirm-description">{pending.description}</p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={() => settle(false)}>{pending.cancelLabel ?? 'Скасувати'}</button>
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
