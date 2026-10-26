'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../routing/locales';

const artworkCopy = {
  uk: { message: 'Нове повідомлення', order: 'Замовлення розпізнано', review: 'Далі — перевірка менеджером', pause: 'Зупинити анімацію', play: 'Відтворити анімацію' },
  en: { message: 'New message', order: 'Order recognised', review: 'Next: manager review', pause: 'Pause animation', play: 'Play animation' },
} as const;

export function HeroArtwork({ locale }: { locale: Locale }) {
  const copy = artworkCopy[locale];
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    setReady(true);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.15 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="marketing-hero__visual hero-art" data-ready={ready} data-playing={visible && !paused}>
      <div className="hero-art__scene" aria-hidden="true">
        <Image src="/images/sales-aito-conversation-sculpture.png" fill priority sizes="(max-width: 1000px) 100vw, 780px" alt="" />
        <span className="hero-art__packet" /><span className="hero-art__packet hero-art__packet--second" /><span className="hero-art__packet hero-art__packet--third" />
        <div className="hero-art__message"><span className="hero-art__signal" />{copy.message}<span className="hero-art__typing"><i /><i /><i /></span></div>
        <div className="hero-art__order"><span className="hero-art__check">✓</span><div><strong>{copy.order}</strong><span>{copy.review}</span></div></div>
      </div>
      {ready && <button type="button" className="icon-button hero-art__control" aria-label={paused ? copy.play : copy.pause} aria-pressed={paused} onClick={() => setPaused(value => !value)}><span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span></button>}
    </div>
  );
}
