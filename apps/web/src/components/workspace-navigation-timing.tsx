'use client';

import { useEffect } from 'react';

type TimedRoute = 'dashboard' | 'orders';
type LongFrameTiming = PerformanceEntry & {
  renderStart?: number;
  scripts?: ReadonlyArray<{ startTime: number; duration: number }>;
};

const storageKey = 'sales-aito.workspace-navigation-timing';
let pending: { route: TimedRoute; startedAt: number } | null = null;

function routeResourceTiming(route: TimedRoute, startedAt: number, readyEffectAt: number, paintedAt: number) {
  const pathname = `/${route}`;
  let latestResponseEnd = -1;
  let latestRequestStart = -1;
  let routeResourceCount = 0;
  try {
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (entry.initiatorType !== 'fetch' || entry.startTime < startedAt || entry.responseEnd > paintedAt) continue;
      const url = new URL(entry.name);
      if (url.origin !== window.location.origin || url.pathname !== pathname) continue;
      routeResourceCount += 1;
      if (entry.responseEnd > latestResponseEnd) {
        latestResponseEnd = entry.responseEnd;
        latestRequestStart = entry.startTime;
      }
    }
  } catch {
    return { routeResourceCount: 0 };
  }
  if (routeResourceCount === 0) return { routeResourceCount };
  return {
    routeResourceCount,
    routeRequestStartMs: Math.max(0, Math.round(latestRequestStart - startedAt)),
    routeFetchDurationMs: Math.max(0, Math.round(latestResponseEnd - latestRequestStart)),
    routeResponseEndMs: Math.max(0, Math.round(latestResponseEnd - startedAt)),
    afterResponseMs: Math.max(0, Math.round(paintedAt - latestResponseEnd)),
    ...(latestResponseEnd <= readyEffectAt ? { responseToReadyEffectMs: Math.max(0, Math.round(readyEffectAt - latestResponseEnd)) } : {}),
  };
}

function isEnabledInThisTab(): boolean {
  try {
    const requested = new URLSearchParams(window.location.search).get('navTiming');
    if (requested === '1') window.sessionStorage.setItem(storageKey, '1');
    if (requested === '0') window.sessionStorage.removeItem(storageKey);
    return window.sessionStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

export function beginWorkspaceNavigationTiming(destination: string, currentPathname: string) {
  pending = null;
  if (!isEnabledInThisTab() || destination === currentPathname) return;
  const route = destination === '/dashboard' ? 'dashboard' : destination === '/orders' ? 'orders' : null;
  if (route) pending = { route, startedAt: performance.now() };
}

export function WorkspaceNavigationReady({ route }: { route: TimedRoute }) {
  useEffect(() => {
    if (!isEnabledInThisTab() || !pending || pending.route !== route) return;
    const sample = pending;
    const readyEffectAt = performance.now();
    let mounted = true;
    const longFrames: PerformanceEntry[] = [];
    let longFrameObserver: PerformanceObserver | null = null;
    try {
      if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
        longFrameObserver = new PerformanceObserver((list) => {
          longFrames.push(...list.getEntries().slice(0, Math.max(0, 200 - longFrames.length)));
        });
        longFrameObserver.observe({ type: 'long-animation-frame', buffered: true });
      }
    } catch {
      longFrameObserver?.disconnect();
      longFrameObserver = null;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!mounted || pending !== sample || !isEnabledInThisTab()) return;
      const paintedAt = performance.now();
      requestAnimationFrame(() => {
        if (!mounted || pending !== sample || !isEnabledInThisTab()) return;
        if (longFrameObserver) {
          longFrames.push(...longFrameObserver.takeRecords().slice(0, Math.max(0, 200 - longFrames.length)));
          longFrameObserver.disconnect();
        }
        let longFrameCount = 0;
        let longFrameOverlapMs = 0;
        let longFrameMaxOverlapMs = 0;
        let longFrameAttributedScriptCount = 0;
        let longFrameAttributedScriptMs = 0;
        let longFrameRenderMs = 0;
        for (const frame of longFrames as LongFrameTiming[]) {
          if (!Number.isFinite(frame.startTime) || !Number.isFinite(frame.duration)) continue;
          const overlap = Math.max(0, Math.min(paintedAt, frame.startTime + frame.duration) - Math.max(readyEffectAt, frame.startTime));
          if (overlap <= 0) continue;
          longFrameCount += 1;
          longFrameOverlapMs += overlap;
          longFrameMaxOverlapMs = Math.max(longFrameMaxOverlapMs, overlap);
          if (Number.isFinite(frame.renderStart) && (frame.renderStart ?? 0) > 0) {
            longFrameRenderMs += Math.max(0, Math.min(paintedAt, frame.startTime + frame.duration) - Math.max(readyEffectAt, frame.renderStart ?? 0));
          }
          for (const script of frame.scripts ?? []) {
            if (!Number.isFinite(script.startTime) || !Number.isFinite(script.duration)) continue;
            const scriptOverlap = Math.max(0, Math.min(paintedAt, script.startTime + script.duration) - Math.max(readyEffectAt, script.startTime));
            if (scriptOverlap <= 0) continue;
            longFrameAttributedScriptCount += 1;
            longFrameAttributedScriptMs += scriptOverlap;
          }
        }
        const durationMs = Math.max(0, Math.round(paintedAt - sample.startedAt));
        pending = null;
        console.info(`workspace_navigation_ready ${JSON.stringify({
          route,
          durationMs,
          readyEffectMs: Math.max(0, Math.round(readyEffectAt - sample.startedAt)),
          ...routeResourceTiming(route, sample.startedAt, readyEffectAt, paintedAt),
          effectToPaintMs: Math.max(0, Math.round(paintedAt - readyEffectAt)),
          longFrameSupported: longFrameObserver !== null,
          longFrameCount,
          longFrameOverlapMs: Math.round(longFrameOverlapMs),
          longFrameMaxOverlapMs: Math.round(longFrameMaxOverlapMs),
          longFrameAttributedScriptCount,
          longFrameAttributedScriptMs: Math.round(longFrameAttributedScriptMs),
          longFrameRenderMs: Math.round(longFrameRenderMs),
        })}`);
      });
    }));
    return () => { mounted = false; longFrameObserver?.disconnect(); };
  }, [route]);
  return null;
}
