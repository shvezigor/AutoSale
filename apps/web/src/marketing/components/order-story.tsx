'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../routing/locales';

const storyCopy = {
  uk: {
    caption: 'Ілюстрація процесу · вигадані дані',
    message: 'Повідомлення в Instagram',
    customer: 'Покупець',
    request: 'Хочу два зелені термогорнятка',
    recognition: 'AITO розпізнає замовлення',
    catalogue: 'Збіг у вашому каталозі',
    product: 'Термогорнятко · зелене',
    quantity: 'Кількість',
    result: 'Замовлення з діалогу',
    review: 'Очікує перевірки менеджером',
    note: 'Ви перевіряєте. AITO прибирає повторне введення.',
  },
  en: {
    caption: 'Workflow illustration · fictional data',
    message: 'Instagram message',
    customer: 'Customer',
    request: 'I would like two green travel mugs',
    recognition: 'AITO recognises the order',
    catalogue: 'Matched to your catalogue',
    product: 'Travel mug · green',
    quantity: 'Quantity',
    result: 'An order from a conversation',
    review: 'Waiting for manager review',
    note: 'You review. AITO takes care of the duplicate entry.',
  },
} as const;

export function OrderStory({ locale }: { locale: Locale }) {
  const copy = storyCopy[locale];
  const ref = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setPlaying(entry?.isIntersecting ?? false);
    }, { threshold: 0.2 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={ref} className="order-story" data-playing={playing}>
      <figcaption>{copy.caption}</figcaption>
      <ol className="order-story__stages">
        <li className="order-story__stage">
          <p className="order-story__label"><span aria-hidden="true">01</span>{copy.message}</p>
          <div className="order-story__message">
            <span className="order-story__avatar" aria-hidden="true">M</span>
            <div><span className="order-story__customer">{copy.customer}</span><p>{copy.request}</p></div>
          </div>
          <span className="order-story__connector" aria-hidden="true">→</span>
        </li>
        <li className="order-story__stage order-story__stage--ai">
          <p className="order-story__label"><span aria-hidden="true">02</span>{copy.recognition}</p>
          <p className="order-story__match"><span aria-hidden="true">✓</span>{copy.catalogue}</p>
          <p className="order-story__product">{copy.product}</p>
          <p className="order-story__quantity">{copy.quantity}<strong>2</strong></p>
          <span className="order-story__connector" aria-hidden="true">→</span>
        </li>
        <li className="order-story__stage order-story__stage--result">
          <p className="order-story__label"><span aria-hidden="true">03</span>{copy.result}</p>
          <span className="order-story__order">AITO <span aria-hidden="true">/</span> DEMO</span>
          <p className="order-story__review"><span aria-hidden="true">◉</span>{copy.review}</p>
          <p className="order-story__note">{copy.note}</p>
        </li>
      </ol>
    </figure>
  );
}
