import type { CatalogueProduct } from '../../../../packages/contracts/src/catalogue';

import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import { CatalogueTable } from '../../src/components/catalogue-table';
import { AuthenticatedShell } from '../../src/components/authenticated-shell';

export const dynamic = 'force-dynamic';

type CataloguePageProps = { searchParams: Promise<{ page?: string | string[]; pageSize?: string | string[]; search?: string | string[] }> };
type CatalogueResponse = { items: CatalogueProduct[]; page: number; pageSize: number; total: number };

export default async function CataloguePage({ searchParams }: CataloguePageProps) {
  const session = await getServerSession();
  if (!session) return null;
  if (!session.membershipRole) return <main className="route-state"><h1>Каталог недоступний</h1><p>Виберіть організацію, щоб переглядати її каталог.</p></main>;

  const params = await searchParams;
  const page = positiveInteger(params.page) ?? 1;
  const pageSize = allowedPageSize(params.pageSize);
  const search = textParam(params.search);
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) query.set('search', search);
  const response = await authenticatedApiFetch(`/api/catalogue?${query.toString()}`);
  if (!response.ok) throw new Error('Не вдалося завантажити каталог');
  const catalogue = await response.json() as CatalogueResponse;

  return <AuthenticatedShell active="catalogue" session={session}><main className="catalogue-layout catalogue-layout-content"><section className="catalogue-content"><header className="catalogue-header"><h1>Каталог товарів</h1><p>{session.membershipRole === 'OWNER' ? 'Додавайте та оновлюйте товари, які AI використовує для розпізнавання замовлень.' : 'Переглядайте товари, які AI використовує для розпізнавання замовлень.'}</p></header><p className="catalogue-settings-link">Джерела каталогу налаштовуються в розділі <a href="/settings?tab=data">Налаштування → Дані</a>.</p><CatalogueTable page={catalogue.page} pageSize={catalogue.pageSize} products={catalogue.items} search={search} session={session} total={catalogue.total} /></section></main></AuthenticatedShell>;
}

function positiveInteger(value: string | string[] | undefined) { const parsed = Number(Array.isArray(value) ? value[0] : value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function allowedPageSize(value: string | string[] | undefined) { const parsed = positiveInteger(value); return parsed && [10, 25, 50, 100].includes(parsed) ? parsed : 25; }
function textParam(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) ?? ''; }
