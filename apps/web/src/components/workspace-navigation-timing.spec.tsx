import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginWorkspaceNavigationTiming, WorkspaceNavigationReady } from './workspace-navigation-timing';

const storageKey = 'sales-aito.workspace-navigation-timing';
let frameCallbacks: FrameRequestCallback[] = [];

function paintNextFrame() {
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  callbacks.forEach((callback) => callback(0));
}

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard');
  window.sessionStorage.clear();
  frameCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('workspace navigation timing', () => {
  it('logs only a fixed destination and click-to-ready duration after explicit opt-in', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const now = vi.spyOn(performance, 'now').mockReturnValue(200);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    now.mockReturnValue(865);
    render(<WorkspaceNavigationReady route="orders" />);

    expect(info).not.toHaveBeenCalled();
    paintNextFrame();
    expect(info).not.toHaveBeenCalled();
    paintNextFrame();

    expect(info).toHaveBeenCalledExactlyOnceWith('workspace_navigation_ready {"route":"orders","durationMs":665,"routeResourceCount":0}');
    expect(window.sessionStorage.getItem(storageKey)).toBe('1');
  });

  it('separates same-origin route response time from the remaining paint delay without logging resource URLs', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: `${window.location.origin}/orders?_rsc=private-customer-id`, initiatorType: 'fetch', startTime: 150, responseEnd: 360 },
      { name: `${window.location.origin}/orders?_rsc=prefetched`, initiatorType: 'fetch', startTime: 90, responseEnd: 110 },
      { name: `${window.location.origin}/orders/secret-id`, initiatorType: 'fetch', startTime: 170, responseEnd: 300 },
      { name: 'https://other.example.test/orders', initiatorType: 'fetch', startTime: 180, responseEnd: 280 },
    ] as unknown as PerformanceEntry[]);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    now.mockReturnValue(600);
    render(<WorkspaceNavigationReady route="orders" />);
    paintNextFrame();
    paintNextFrame();

    expect(info).toHaveBeenCalledExactlyOnceWith('workspace_navigation_ready {"route":"orders","durationMs":500,"routeResourceCount":1,"routeResponseEndMs":260,"afterResponseMs":240}');
  });

  it('stays silent for ordinary sessions and for unrelated destinations', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    render(<WorkspaceNavigationReady route="orders" />);
    expect(info).not.toHaveBeenCalled();

    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    beginWorkspaceNavigationTiming('/catalogue', '/dashboard');
    render(<WorkspaceNavigationReady route="orders" />);
    expect(info).not.toHaveBeenCalled();
  });

  it('waits for the matching destination and reports it only once', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(performance, 'now').mockReturnValue(100);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    render(<WorkspaceNavigationReady route="dashboard" />);
    expect(info).not.toHaveBeenCalled();
    render(<StrictMode><WorkspaceNavigationReady route="orders" /></StrictMode>);
    paintNextFrame();
    paintNextFrame();
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('does not report a destination removed before it can paint', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    const destination = render(<WorkspaceNavigationReady route="orders" />);
    destination.unmount();
    paintNextFrame();
    paintNextFrame();

    expect(info).not.toHaveBeenCalled();
  });

  it('clears the tab-only diagnostic when explicitly disabled', () => {
    window.sessionStorage.setItem(storageKey, '1');
    window.history.replaceState({}, '', '/dashboard?navTiming=0');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    render(<WorkspaceNavigationReady route="orders" />);

    expect(info).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('applies the tab switch on page load before another sidebar click', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const enabled = render(<WorkspaceNavigationReady route="dashboard" />);
    expect(window.sessionStorage.getItem(storageKey)).toBe('1');

    enabled.unmount();
    window.history.replaceState({}, '', '/dashboard?navTiming=0');
    render(<WorkspaceNavigationReady route="dashboard" />);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });
});
