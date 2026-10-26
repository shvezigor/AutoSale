import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderStory } from './order-story';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('marketing order story', () => {
  it('keeps the fictional example and manager review readable without browser motion APIs', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<OrderStory locale="uk" />);
    expect(screen.getByText(/вигадані дані/)).toBeVisible();
    expect(screen.getByText('Хочу два зелені термогорнятка')).toBeVisible();
    expect(screen.getByText('Очікує перевірки менеджером')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('figure')).toHaveAttribute('data-playing', 'false');
  });

  it('plays only while visible and disconnects when navigating away', () => {
    let onIntersection: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { onIntersection = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const view = render(<OrderStory locale="en" />);
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('data-playing', 'false');
    act(() => onIntersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(figure).toHaveAttribute('data-playing', 'true');
    act(() => onIntersection([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(figure).toHaveAttribute('data-playing', 'false');
    expect(screen.getByText('Waiting for manager review')).toBeVisible();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
