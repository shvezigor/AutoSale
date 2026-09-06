'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type ActivityContextValue = {
  activeCount: number;
  begin(label: string): () => void;
  run<T>(label: string, operation: () => Promise<T>): Promise<T>;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activeCount, setActiveCount] = useState(0);
  const [latestLabel, setLatestLabel] = useState('Виконується фонова операція');
  const begin = useCallback((label: string) => {
    let finished = false;
    setLatestLabel(label);
    setActiveCount((value) => value + 1);
    return () => {
      if (finished) return;
      finished = true;
      setActiveCount((value) => Math.max(0, value - 1));
    };
  }, []);
  const run = useCallback(async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    const finish = begin(label);
    try { return await operation(); }
    finally { finish(); }
  }, [begin]);
  const value = useMemo(() => ({ activeCount, begin, run }), [activeCount, begin, run]);
  const valueText = activeCount === 1 ? '1 активна операція' : `${activeCount} активні операції`;

  return <ActivityContext.Provider value={value}>
    {activeCount > 0 && <>
      <div className="activity-bar" role="progressbar" aria-label={latestLabel} aria-valuetext={valueText}><span /></div>
      <div className="activity-overlay" aria-label={latestLabel} aria-live="polite" aria-busy="true">
        <div className="activity-overlay-card">
          <span className="activity-spinner" aria-hidden="true" />
          <strong>{latestLabel}</strong>
          <span>Будь ласка, зачекайте — не закривайте сторінку.</span>
        </div>
      </div>
    </>}
    {children}
  </ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity must be used inside ActivityProvider');
  return value;
}
