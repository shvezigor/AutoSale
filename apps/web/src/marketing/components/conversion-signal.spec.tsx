import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversionPageSignal, PlanInterestLink } from './conversion-signal';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('privacy-minimal conversion signals', () => {
  it('sends one fixed page event per mount without URL, query or contact data', () => {
    const request = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', request);
    const view = render(<ConversionPageSignal event="pricing_view" locale="uk" />);
    view.rerender(<ConversionPageSignal event="pricing_view" locale="uk" />);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/api/conversion/events', expect.objectContaining({
      body: JSON.stringify({ event: 'pricing_view', locale: 'uk' }), keepalive: true,
    }));
  });

  it('records the approved plan and keeps the original navigation destination', () => {
    const request = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', request);
    render(<PlanInterestLink href="/register?plan=growth" locale="en" planId="growth">Start</PlanInterestLink>);
    screen.getByRole('link', { name: 'Start' }).addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole('link', { name: 'Start' }));
    expect(request).toHaveBeenCalledWith('/api/conversion/events', expect.objectContaining({
      body: JSON.stringify({ event: 'plan_interest', locale: 'en', planId: 'growth' }),
    }));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/register?plan=growth');
  });
});
