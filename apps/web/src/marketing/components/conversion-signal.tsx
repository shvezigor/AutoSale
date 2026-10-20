'use client';

import type { ConversionEvent, ConversionPlanId } from '../../../../../packages/contracts/src/conversion-events';
import { type ReactNode, useEffect, useRef } from 'react';

import type { Locale } from '../routing/locales';

export function sendConversionSignal(event: ConversionEvent): void {
  try {
    void fetch('/api/conversion/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch { /* Analytics must never interrupt navigation. */ }
}

export function ConversionPageSignal({ event, locale }: { event: 'pricing_view' | 'registration_arrival'; locale: Locale }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    sendConversionSignal({ event, locale });
  }, [event, locale]);
  return null;
}

export function PlanInterestLink({ children, className, href, locale, planId }: {
  children: ReactNode; className?: string; href: string; locale: Locale; planId: ConversionPlanId;
}) {
  return <a className={className} href={href} onClick={() => sendConversionSignal({ event: 'plan_interest', locale, planId })}>{children}</a>;
}
