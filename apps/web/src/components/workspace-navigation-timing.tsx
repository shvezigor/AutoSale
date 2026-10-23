'use client';

import { useEffect } from 'react';

type TimedRoute = 'dashboard' | 'orders';

const storageKey = 'sales-aito.workspace-navigation-timing';
let pending: { route: TimedRoute; startedAt: number } | null = null;

function routeResourceTiming(route: TimedRoute, startedAt: number, paintedAt: number) {
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
    let mounted = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!mounted || pending !== sample || !isEnabledInThisTab()) return;
      const paintedAt = performance.now();
      const durationMs = Math.max(0, Math.round(paintedAt - sample.startedAt));
      pending = null;
      console.info(`workspace_navigation_ready ${JSON.stringify({ route, durationMs, ...routeResourceTiming(route, sample.startedAt, paintedAt) })}`);
    }));
    return () => { mounted = false; };
  }, [route]);
  return null;
}
