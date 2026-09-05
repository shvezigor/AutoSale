'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { ProductEditor, type EditableProduct } from './product-editor';
import { TablePagination } from './table-pagination';
import { useToast } from './toast-provider';

type CatalogueSession = { membershipRole: 'OWNER' | 'MANAGER' | null };
type CatalogueTableProps = { session: CatalogueSession; products: EditableProduct[]; page: number; pageSize: number; total: number; search?: string };

export function CatalogueTable({ session, products, page, pageSize, total, search = '' }: CatalogueTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const [editing, setEditing] = useState<EditableProduct | 'new' | null>(null);
  const [clearing, setClearing] = useState(false);
  const confirm = useConfirm();
  const activity = useActivity();
  const toast = useToast();
  const isOwner = session.membershipRole === 'OWNER';

  function changePage(nextPage: number) { router.replace(catalogueUrl(query, nextPage, pageSize)); }
  function changePageSize(nextPageSize: number) { router.replace(catalogueUrl(query, 1, nextPageSize)); }
  function submitSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); router.replace(catalogueUrl(query, 1, pageSize)); }
  async function clearCatalogue() {
    if (!await confirm({ title: 'Очистити всі товари?', description: 'Усі товари цього робочого простору буде видалено. Замовлення та історія залишаться без змін.', confirmLabel: 'Так, очистити', tone: 'danger' })) return;
    setClearing(true);
    try {
      const response = await activity.run('Очищаємо каталог', () => mutatingFetch('/api/catalogue', { method: 'DELETE' }));
      const body = await response.json() as { deleted?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Не вдалося очистити каталог');
      toast.show({ type: 'success', title: 'Каталог очищено', message: `Видалено товарів: ${body.deleted ?? 0}.` });
      setEditing(null);
      router.replace('/catalogue');
      router.refresh?.();
    } catch (reason) {
      toast.show({ type: 'error', title: 'Не вдалося очистити каталог', message: reason instanceof Error ? reason.message : 'Спробуйте ще раз.' });
    } finally { setClearing(false); }
  }

  return <>
    <div className="catalogue-toolbar">
      <form onSubmit={submitSearch} role="search"><label className="sr-only" htmlFor="catalogue-search">Пошук товарів</label><input id="catalogue-search" onChange={(event) => setQuery(event.target.value)} placeholder="Артикул, назва або аліас" type="search" value={query} /><button className="secondary-button" type="submit">Знайти</button></form>
      {isOwner && <div className="catalogue-toolbar-actions"><button className="danger-text-button" disabled={clearing || total === 0} onClick={() => void clearCatalogue()} type="button">{clearing ? 'Очищаємо…' : 'Очистити каталог'}</button><button className="primary-button catalogue-add-button" onClick={() => setEditing('new')} type="button">Додати товар</button></div>}
    </div>
    {editing === 'new' && isOwner && <ProductEditor onClose={() => setEditing(null)} />}
    {editing !== null && editing !== 'new' && isOwner && <ProductEditor onClose={() => setEditing(null)} product={editing} />}
    {products.length === 0 ? <p className="catalogue-empty" role="status">{search ? 'Товарів за цим запитом не знайдено.' : 'У каталозі ще немає товарів.'}</p> : <>
      <div className="catalogue-table-wrap"><table className="catalogue-table"><caption className="sr-only">Товари каталогу</caption><thead><tr><th scope="col">Товар</th><th scope="col">Артикул</th><th scope="col">Ціна</th><th scope="col">Залишок</th><th scope="col">Статус</th>{isOwner && <th scope="col"><span className="sr-only">Дії</span></th>}</tr></thead><tbody>{products.map((product) => <CatalogueRow isOwner={isOwner} key={product.id ?? product.sku} onEdit={() => setEditing(product)} product={product} />)}</tbody></table></div>
      <div className="catalogue-cards">{products.map((product) => <CatalogueCard isOwner={isOwner} key={product.id ?? product.sku} onEdit={() => setEditing(product)} product={product} />)}</div>
    </>}
    {total > 0 && <TablePagination ariaLabel="Сторінки каталогу" onPageChange={changePage} onPageSizeChange={changePageSize} page={page} pageSize={pageSize} total={total} />}
  </>;
}

function CatalogueRow({ product, isOwner, onEdit }: { product: EditableProduct; isOwner: boolean; onEdit: () => void }) {
  return <tr><td><strong>{product.name}</strong>{product.aliases?.length ? <small>{product.aliases.join(', ')}</small> : null}</td><td>{product.sku}</td><td>{priceLabel(product)}</td><td>{product.stockQuantity ?? '—'}</td><td><Status active={product.active ?? true} /></td>{isOwner && <td><button className="text-button" onClick={onEdit} type="button">Редагувати</button></td>}</tr>;
}

function CatalogueCard({ product, isOwner, onEdit }: { product: EditableProduct; isOwner: boolean; onEdit: () => void }) {
  return <article className="catalogue-card"><div><strong>{product.name}</strong><small>Артикул: {product.sku}</small></div><dl><div><dt>Ціна</dt><dd>{priceLabel(product)}</dd></div><div><dt>Залишок</dt><dd>{product.stockQuantity ?? '—'}</dd></div></dl><div className="catalogue-card-actions"><Status active={product.active ?? true} />{isOwner && <button className="text-button" onClick={onEdit} type="button">Редагувати</button>}</div></article>;
}

function Status({ active }: { active: boolean }) { return <span className={`catalogue-status${active ? ' is-active' : ''}`}>{active ? 'Активний' : 'Неактивний'}</span>; }
function priceLabel(product: EditableProduct) { return product.price === null || product.price === undefined ? '—' : new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(product.price) + (product.currency ? ` ${product.currency}` : ''); }
function catalogueUrl(query: string, page: number, pageSize: number) { const params = new URLSearchParams(); if (query.trim()) params.set('search', query.trim()); if (page > 1) params.set('page', String(page)); if (pageSize !== 25) params.set('pageSize', String(pageSize)); const serialized = params.toString(); return serialized ? `/catalogue?${serialized}` : '/catalogue'; }
