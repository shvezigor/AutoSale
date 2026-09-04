import type { CatalogueProduct } from '../../../../packages/contracts/src/catalogue';

import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import { CatalogueTable } from '../../src/components/catalogue-table';
import { CatalogueImportWizard } from '../../src/components/catalogue-import-wizard';
import type { CatalogueSourceConfiguration, CatalogueSourceHealth } from '../../src/components/catalogue-source-settings';
import { PrimaryNavigation } from '../../src/components/primary-navigation';

export const dynamic = 'force-dynamic';

type CataloguePageProps = { searchParams: Promise<{ page?: string | string[]; search?: string | string[] }> };
type CatalogueResponse = { items: CatalogueProduct[]; page: number; pageSize: number; total: number };

export default async function CataloguePage({ searchParams }: CataloguePageProps) {
  const session = await getServerSession();
  if (!session) return null;
  if (!session.membershipRole) return <main className="route-state"><h1>Каталог недоступний</h1><p>Виберіть організацію, щоб переглядати її каталог.</p></main>;

  const params = await searchParams;
  const page = positiveInteger(params.page) ?? 1;
  const search = textParam(params.search);
  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) query.set('search', search);
  const [response, sourceResponse] = await Promise.all([
    authenticatedApiFetch(`/api/catalogue?${query.toString()}`),
    authenticatedApiFetch('/api/catalogue/sources'),
  ]);
  if (!response.ok || !sourceResponse.ok) throw new Error('Не вдалося завантажити каталог');
  const catalogue = await response.json() as CatalogueResponse;
  const sources = await sourceResponse.json() as CatalogueSourceHealth[];
  let configurations: CatalogueSourceConfiguration[] = [];
  if (session.membershipRole === 'OWNER') {
    const configurationResponses = await Promise.all(sources.map((source) => authenticatedApiFetch(`/api/catalogue/sources/${source.id}`)));
    if (configurationResponses.some((item) => !item.ok)) throw new Error('Не вдалося завантажити джерело каталогу');
    configurations = await Promise.all(configurationResponses.map((item) => item.json() as Promise<CatalogueSourceConfiguration>));
  }

  const reviewRuns = configurations.flatMap((source) => source.pendingReview ? [{ id: source.pendingReview.runId, sourceName: source.displayName, headers: source.pendingReview.headers }] : []);
  return <main className="catalogue-layout"><PrimaryNavigation active="catalogue" session={session} /><section className="catalogue-content"><header className="catalogue-header"><h1>Каталог товарів</h1><p>{session.membershipRole === 'OWNER' ? 'Додавайте та оновлюйте товари, які AI використовує для розпізнавання замовлень.' : 'Переглядайте товари, які AI використовує для розпізнавання замовлень.'}</p></header><p className="catalogue-settings-link">Джерела каталогу налаштовуються в розділі <a href="/settings?tab=google">Налаштування → Google</a>.</p><CatalogueImportWizard session={session} reviewRuns={reviewRuns} /><CatalogueTable page={catalogue.page} pageSize={catalogue.pageSize} products={catalogue.items} search={search} session={session} total={catalogue.total} /></section></main>;
}

function positiveInteger(value: string | string[] | undefined) { const parsed = Number(Array.isArray(value) ? value[0] : value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function textParam(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) ?? ''; }
