'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalI18n } from '../i18n/i18n-provider';
import { createTranslator } from '../i18n/translator';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type ToastInput = { type: ToastType; title: string; message?: string };
type ToastItem = ToastInput & { id: string };
type ToastContextValue = { show(input: ToastInput): string; dismiss(id: string): void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useOptionalI18n()?.t ?? createTranslator('uk');
  const [items, setItems] = useState<ToastItem[]>([]);
  const sequence = useRef(0);
  const dismiss = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const show = useCallback((input: ToastInput) => {
    const id = `toast-${++sequence.current}`;
    setItems((current) => [...current.slice(-3), { ...input, id }]);
    return id;
  }, []);
  const value = useMemo(() => ({ show, dismiss }), [dismiss, show]);

  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-viewport" aria-label={t('toast.viewport')}>
      {items.map((item) => <Toast key={item.id} item={item} dismiss={dismiss} />)}
    </div>
  </ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

function Toast({ item, dismiss }: { item: ToastItem; dismiss(id: string): void }) {
  const t = useOptionalI18n()?.t ?? createTranslator('uk');
  const [paused, setPaused] = useState(false);
  const duration = item.type === 'success' || item.type === 'info' ? 5_000 : item.type === 'warning' ? 8_000 : null;
  useEffect(() => {
    if (duration === null || paused) return;
    const timer = window.setTimeout(() => dismiss(item.id), duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, duration, item.id, paused]);
  return <article
    className={`toast toast-${item.type}`}
    role={item.type === 'error' ? 'alert' : 'status'}
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)}
    onBlur={() => setPaused(false)}
  >
    <span className="toast-icon" aria-hidden="true">{toastIcon(item.type)}</span>
    <div className="toast-copy"><strong>{item.title}</strong>{item.message && <p>{item.message}</p>}</div>
    <button type="button" aria-label={t('toast.close')} onClick={() => dismiss(item.id)}>×</button>
  </article>;
}

function toastIcon(type: ToastType) {
  return ({ success: '✓', error: '!', warning: '!', info: 'i' } as const)[type];
}
