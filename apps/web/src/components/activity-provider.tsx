'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type ActivityContextValue = {
  activeCount: number;
  run<T>(label: string, operation: () => Promise<T>): Promise<T>;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activeCount, setActiveCount] = useState(0);
  const [latestLabel, setLatestLabel] = useState('Виконується фонова операція');
  const run = useCallback(async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    setLatestLabel(label);
    setActiveCount((value) => value + 1);
    try { return await operation(); }
    finally { setActiveCount((value) => Math.max(0, value - 1)); }
  }, []);
  const value = useMemo(() => ({ activeCount, run }), [activeCount, run]);
  const valueText = activeCount === 1 ? '1 активна операція' : `${activeCount} активні операції`;

  return <ActivityContext.Provider value={value}>
    {activeCount > 0 && <div className="activity-bar" role="progressbar" aria-label={latestLabel} aria-valuetext={valueText}><span /></div>}
    {children}
  </ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity must be used inside ActivityProvider');
  return value;
}
