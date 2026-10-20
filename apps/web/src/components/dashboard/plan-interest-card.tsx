'use client';

import { useState } from 'react';

import type { ConversionPlanId } from '../../../../../packages/contracts/src/conversion-events';
import { mutatingFetch } from '../../auth/csrf-fetch';
import { useI18n } from '../../i18n/i18n-provider';
import { LoadingButton } from '../loading-button';

const plans: ConversionPlanId[] = ['start', 'growth', 'scale'];

export function planContactHref(planId: ConversionPlanId): string {
  return `mailto:shvezigor@gmail.com?subject=${encodeURIComponent(`Sales AITO ${planId}`)}`;
}

export async function attemptPlanInterest(planId: ConversionPlanId): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      mutatingFetch('/api/conversion/plan-interest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planId }),
      }),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2_000); }),
    ]);
  } catch { /* The contact path must remain available when measurement is offline. */ }
  finally { if (timeout) clearTimeout(timeout); }
  return planContactHref(planId);
}

export function PlanInterestCard() {
  const { locale } = useI18n();
  const uk = locale === 'uk';
  const [planId, setPlanId] = useState<ConversionPlanId>('growth');
  const [pending, setPending] = useState(false);

  async function discuss() {
    setPending(true);
    const href = await attemptPlanInterest(planId);
    setPending(false);
    window.location.assign(href);
  }

  return <section className="dashboard-plan-interest" aria-labelledby="dashboard-plan-interest-heading">
    <div><h2 id="dashboard-plan-interest-heading">{uk ? 'Обговорити тариф' : 'Discuss a plan'}</h2>
      <p>{uk ? 'Оберіть тариф і напишіть команді Sales AITO. Ця дія не оформлює підписку, не списує кошти й не обіцяє зворотного дзвінка.' : 'Choose a plan and email the Sales AITO team. This does not subscribe you, charge you, or promise a callback.'}</p>
    </div>
    <div className="dashboard-plan-interest-controls">
      <label htmlFor="dashboard-plan-select">{uk ? 'Тариф' : 'Plan'}</label>
      <select id="dashboard-plan-select" value={planId} onChange={(event) => setPlanId(event.target.value as ConversionPlanId)}>
        {plans.map((plan) => <option key={plan} value={plan}>{plan[0]!.toUpperCase() + plan.slice(1)}</option>)}
      </select>
      <LoadingButton className="primary-button" pending={pending} pendingLabel={uk ? 'Відкриваємо пошту…' : 'Opening email…'} type="button" onClick={() => void discuss()}>{uk ? 'Обговорити тариф' : 'Discuss a plan'}</LoadingButton>
      <a className="text-button" href={planContactHref(planId)}>{uk ? 'Або напишіть напряму' : 'Or email directly'}</a>
    </div>
  </section>;
}
