import type { CatalogueProduct } from '../../../../../packages/contracts/src/catalogue';
import Link from 'next/link';

import { authenticatedApiFetch, getServerSession } from '../../../src/auth/session';
import { CatalogueTable } from '../../../src/components/catalogue-table';
import { CatalogueImportWizard } from '../../../src/components/catalogue-import-wizard';
import { createTranslator } from '../../../src/i18n/translator';

export const dynamic = 'force-dynamic';

type CatalogueSort = 'sku' | 'name' | 'price' | 'stock' | 'status';
type SortDirection = 'asc' | 'desc';
type CataloguePageProps = { searchParams: Promise<{ page?: string | string[]; pageSize?: string | string[]; search?: string | string[]; review?: string | string[]; sort?: string | string[]; direction?: string | string[] }> };
type CatalogueResponse = { items: CatalogueProduct[]; page: number; pageSize: number; total: number };

export default async function CataloguePage({ searchParams }: CataloguePageProps) {
  const session = await getServerSession();
  if (!session) return null;
  const t = createTranslator(session.locale ?? 'uk');
  if (!session.membershipRole) return <main className="route-state"><h1>{t('catalogue.unavailable')}</h1><p>{t('catalogue.selectOrganization')}</p></main>;

  const params = await searchParams;
  const page = positiveInteger(params.page) ?? 1;
  const pageSize = allowedPageSize(params.pageSize);
  const search = textParam(params.search);
  const sort = sortParam(params.sort);
  const direction = directionParam(params.direction);
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) query.set('search', search);
  if (sort !== 'name') query.set('sort', sort);
  if (direction !== 'asc') query.set('direction', direction);
  const response = await authenticatedApiFetch(`/api/catalogue?${query.toString()}`);
  if (!response.ok) throw new Error(t('catalogue.loadError'));
  const catalogue = await response.json() as CatalogueResponse;
  const reviewId = uuidParam(params.review);
  let review: { id: string; headers: string[] } | undefined;
  if (session.membershipRole === 'OWNER' && reviewId) {
    const reviewResponse = await authenticatedApiFetch(`/api/catalogue/imports/${reviewId}`);
    if (reviewResponse.ok) {
      const candidate = await reviewResponse.json() as { id?: string; status?: string; headers?: unknown };
      if (candidate.id === reviewId && candidate.status === 'MAPPING_REVIEW' && Array.isArray(candidate.headers) && candidate.headers.every((header) => typeof header === 'string')) review = { id: reviewId, headers: candidate.headers as string[] };
    }
  }

  return <main className="catalogue-layout catalogue-layout-content"><section className="catalogue-content"><header className="catalogue-header"><h1>{t('catalogue.title')}</h1><p>{session.membershipRole === 'OWNER' ? t('catalogue.ownerDescription') : t('catalogue.managerDescription')}</p></header><p className="catalogue-settings-link">{t('catalogue.sourcesPrefix')} <Link href="/settings?tab=data">{t('catalogue.settingsData')}</Link>.</p>{review ? <CatalogueImportWizard session={session} initialReview={review} /> : null}<CatalogueTable direction={direction} page={catalogue.page} pageSize={catalogue.pageSize} products={catalogue.items} search={search} session={session} sort={sort} total={catalogue.total} /></section></main>;
}

function positiveInteger(value: string | string[] | undefined) { const parsed = Number(Array.isArray(value) ? value[0] : value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function allowedPageSize(value: string | string[] | undefined) { const parsed = positiveInteger(value); return parsed && [10, 25, 50, 100].includes(parsed) ? parsed : 25; }
function textParam(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) ?? ''; }
function uuidParam(value: string | string[] | undefined) { const text = textParam(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null; }
function sortParam(value: string | string[] | undefined): CatalogueSort { const candidate = Array.isArray(value) ? value[0] : value; return candidate && ['sku', 'name', 'price', 'stock', 'status'].includes(candidate) ? candidate as CatalogueSort : 'name'; }
function directionParam(value: string | string[] | undefined): SortDirection { return (Array.isArray(value) ? value[0] : value) === 'desc' ? 'desc' : 'asc'; }
