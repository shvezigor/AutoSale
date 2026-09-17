import Link from 'next/link';

import { siteCopy } from '../content/site';
import { localizedPath, type Locale } from '../routing/locales';

export function MarketingFooter({ locale }: { locale: Locale }) {
  const copy = siteCopy[locale];
  return (
    <footer className="marketing-footer">
      <div className="marketing-shell marketing-footer__grid">
        <div>
          <Link className="marketing-brand" href={localizedPath(locale)} aria-label="Sales AITO home">
            <span className="marketing-brand__mark" aria-hidden="true">A</span>
            <span>Sales AITO</span>
          </Link>
          <p>{copy.footerSummary}</p>
        </div>
        <div className="marketing-footer__links">
          {copy.nav.slice(0, 5).map((item) => <Link key={item.href} href={localizedPath(locale, item.href)}>{item.label}</Link>)}
        </div>
        <div className="marketing-footer__links">
          <Link href="/privacy">{copy.privacy}</Link>
          <Link href="/terms">{copy.legal}</Link>
          <Link href="/login">{copy.signIn}</Link>
        </div>
      </div>
      <div className="marketing-shell marketing-footer__bottom">
        <span>© {new Date().getFullYear()} Sales AITO</span>
        <span>{copy.languageName}</span>
      </div>
    </footer>
  );
}
