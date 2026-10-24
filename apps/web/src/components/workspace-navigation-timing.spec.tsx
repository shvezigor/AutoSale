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
  it('separates attributed script and rendering time in a long frame without exposing script sources', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const records = [{
      name: 'long-animation-frame', entryType: 'long-animation-frame', startTime: 480, duration: 240,
      blockingDuration: 180, firstUIEventTimestamp: 0, renderStart: 650, styleAndLayoutStart: 660,
      scripts: [
        { startTime: 470, duration: 70, sourceURL: 'https://private.example.test/customer-id', sourceFunctionName: 'private-customer' },
        { startTime: 610, duration: 80, sourceURL: 'https://private.example.test/order-id', sourceFunctionName: 'private-order' },
        { startTime: 710, duration: 20, sourceURL: 'https://private.example.test/after-paint' },
      ],
    }] as unknown as PerformanceEntry[];
    class LongFrameObserver {
      static supportedEntryTypes = ['long-animation-frame'];
      observe() {}
      takeRecords() { return records; }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', LongFrameObserver);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    now.mockReturnValue(500);
    render(<WorkspaceNavigationReady route="orders" />);
    now.mockReturnValue(700);
    paintNextFrame();
    paintNextFrame();
    paintNextFrame();

    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line.slice('workspace_navigation_ready '.length))).toEqual(expect.objectContaining({
      longFrameCount: 1,
      longFrameOverlapMs: 200,
      longFrameAttributedScriptCount: 2,
      longFrameAttributedScriptMs: 120,
      longFrameRenderMs: 50,
    }));
    expect(line).not.toContain('private-');
  });

  it('reports only numeric long-frame overlap between ready effect and measured paint', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const records = [
      { startTime: 400, duration: 50, name: 'private-before-effect' },
      { startTime: 490, duration: 80, name: 'private-customer-url', scripts: [{ sourceURL: 'private-script-url' }] },
      { startTime: 600, duration: 120, name: 'private-after-paint' },
      { startTime: 750, duration: 60, name: 'private-after-paint' },
    ] as unknown as PerformanceEntry[];
    class LongFrameObserver {
      static supportedEntryTypes = ['long-animation-frame'];
      observe() {}
      takeRecords() { return records; }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', LongFrameObserver);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    now.mockReturnValue(500);
    render(<WorkspaceNavigationReady route="orders" />);
    now.mockReturnValue(700);
    paintNextFrame();
    paintNextFrame();
    paintNextFrame();

    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line.slice('workspace_navigation_ready '.length))).toEqual(expect.objectContaining({
      route: 'orders',
      durationMs: 600,
      longFrameSupported: true,
      longFrameCount: 2,
      longFrameOverlapMs: 170,
      longFrameMaxOverlapMs: 100,
    }));
    expect(line).not.toContain('private-');
  });

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
    expect(info).not.toHaveBeenCalled();
    paintNextFrame();

    expect(info).toHaveBeenCalledExactlyOnceWith('workspace_navigation_ready {"route":"orders","durationMs":665,"readyEffectMs":665,"routeResourceCount":0,"effectToPaintMs":0,"longFrameSupported":false,"longFrameCount":0,"longFrameOverlapMs":0,"longFrameMaxOverlapMs":0,"longFrameAttributedScriptCount":0,"longFrameAttributedScriptMs":0,"longFrameRenderMs":0}');
    expect(window.sessionStorage.getItem(storageKey)).toBe('1');
  });

  it('separates click-to-request delay, route fetch duration and paint delay without logging resource URLs', () => {
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
    paintNextFrame();

    expect(info).toHaveBeenCalledExactlyOnceWith('workspace_navigation_ready {"route":"orders","durationMs":500,"readyEffectMs":500,"routeResourceCount":1,"routeRequestStartMs":50,"routeFetchDurationMs":210,"routeResponseEndMs":260,"afterResponseMs":240,"responseToReadyEffectMs":240,"effectToPaintMs":0,"longFrameSupported":false,"longFrameCount":0,"longFrameOverlapMs":0,"longFrameMaxOverlapMs":0,"longFrameAttributedScriptCount":0,"longFrameAttributedScriptMs":0,"longFrameRenderMs":0}');
  });

  it('separates route response to ready effect from ready effect to paint', () => {
    window.history.replaceState({}, '', '/dashboard?navTiming=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: `${window.location.origin}/orders?_rsc=private-customer-id`, initiatorType: 'fetch', startTime: 150, responseEnd: 300 },
    ] as unknown as PerformanceEntry[]);

    beginWorkspaceNavigationTiming('/orders', '/dashboard');
    now.mockReturnValue(450);
    render(<WorkspaceNavigationReady route="orders" />);
    now.mockReturnValue(600);
    paintNextFrame();
    paintNextFrame();
    paintNextFrame();

    expect(info).toHaveBeenCalledOnce();
    const line = String(info.mock.calls[0]?.[0]);
    expect(line.startsWith('workspace_navigation_ready ')).toBe(true);
    expect(JSON.parse(line.slice('workspace_navigation_ready '.length))).toEqual(expect.objectContaining({
      route: 'orders',
      durationMs: 500,
      routeResponseEndMs: 200,
      readyEffectMs: 350,
      responseToReadyEffectMs: 150,
      effectToPaintMs: 150,
    }));
    expect(line).not.toContain('private-customer-id');
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
