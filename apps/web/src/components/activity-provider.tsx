'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useOptionalI18n } from '../i18n/i18n-provider';
import { createTranslator } from '../i18n/translator';

type ActivityContextValue = {
  activeCount: number;
  begin(label: string): () => void;
  run<T>(label: string, operation: () => Promise<T>): Promise<T>;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const t = useOptionalI18n()?.t ?? createTranslator('uk');
  const [activeCount, setActiveCount] = useState(0);
  const [latestLabel, setLatestLabel] = useState(t('activity.defaultLabel'));
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
  const valueText = activeCount === 1 ? t('activity.oneActive') : t('activity.manyActive', { count: activeCount });

  return <ActivityContext.Provider value={value}>
    {activeCount > 0 && <>
      <div className="activity-overlay" aria-label={latestLabel} aria-live="polite" aria-busy="true">
        <div className="activity-overlay-card">
          <span className="activity-spinner" role="progressbar" aria-label={latestLabel} aria-valuetext={valueText} />
          <strong>{latestLabel}</strong>
          <span>{t('activity.wait')}</span>
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
