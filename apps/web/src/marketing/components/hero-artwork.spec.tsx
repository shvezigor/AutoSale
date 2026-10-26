import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeroArtwork } from './hero-artwork';

vi.mock('next/image', () => ({ default: ({ fill, priority, ...props }: { fill?: boolean; priority?: boolean }) => <img {...props} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('animated hero artwork', () => {
  it('keeps the generated artwork as a static fallback without browser APIs', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<HeroArtwork locale="uk" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/images/sales-aito-conversation-sculpture.png');
    expect(container.querySelector('.hero-art')).toHaveAttribute('data-playing', 'false');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('respects an explicit pause across visibility changes and disconnects on unmount', () => {
    let notify: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const view = render(<HeroArtwork locale="en" />);
    const scene = view.container.querySelector('.hero-art');
    const intersect = (visible: boolean) => act(() => notify([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver));
    intersect(true);
    expect(scene).toHaveAttribute('data-playing', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
    expect(scene).toHaveAttribute('data-playing', 'false');
    intersect(false);
    intersect(true);
    expect(scene).toHaveAttribute('data-playing', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Play animation' }));
    expect(scene).toHaveAttribute('data-playing', 'true');
    intersect(false);
    expect(scene).toHaveAttribute('data-playing', 'false');
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
