import Link from 'next/link';

import { siteCopy } from '../content/site';
import { localizedPath, type Locale } from '../routing/locales';
import { LocaleSwitcher } from './locale-switcher';

type MarketingHeaderProps = {
  locale: Locale;
};

export function MarketingHeader({ locale }: MarketingHeaderProps) {
  const copy = siteCopy[locale];
  return (
    <>
      <a className="marketing-skip-link" href="#main-content">{copy.skipLink}</a>
      <header className="marketing-header">
        <div className="marketing-shell marketing-header__inner">
          <Link className="marketing-brand" href={localizedPath(locale)} aria-label="Sales AITO">
            <span className="marketing-brand__mark" aria-hidden="true">A</span>
            <span>Sales AITO</span>
          </Link>
          <nav className="marketing-nav" aria-label={copy.navigationLabel}>
            {copy.nav.map((item) => (
              <Link key={item.href} href={localizedPath(locale, item.href)}>{item.label}</Link>
            ))}
          </nav>
          <div className="marketing-header__actions">
            <LocaleSwitcher className="locale-link" locale={locale} />
            <Link className="marketing-login" href="/login">{copy.signIn}</Link>
            <Link className="marketing-button marketing-button--compact" href="/register">{copy.startFree}</Link>
          </div>
          <details className="marketing-menu">
            <summary>{copy.menuLabel}</summary>
            <div className="marketing-menu__panel">
              {copy.nav.map((item) => (
                <Link key={item.href} href={localizedPath(locale, item.href)}>{item.label}</Link>
              ))}
              <Link href="/login">{copy.signIn}</Link>
              <LocaleSwitcher locale={locale} />
              <Link className="marketing-button" href="/register">{copy.startFree}</Link>
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
