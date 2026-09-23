'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { ProductEditor, type EditableProduct } from './product-editor';
import { TablePagination } from './table-pagination';
import { MobileSortControl, SortableHeader, type SortDirection } from './table-sort-control';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';
import { localizeApiError } from '../i18n/error-message';

type CatalogueSession = { membershipRole: 'OWNER' | 'MANAGER' | null };
type CatalogueSort = 'sku' | 'name' | 'price' | 'stock' | 'status';
type CatalogueTableProps = { session: CatalogueSession; products: EditableProduct[]; page: number; pageSize: number; total: number; search?: string; sort?: CatalogueSort; direction?: SortDirection };

export function CatalogueTable({ session, products, page, pageSize, total, search = '', sort = 'name', direction = 'asc' }: CatalogueTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const [editing, setEditing] = useState<EditableProduct | 'new' | null>(null);
  const [clearing, setClearing] = useState(false);
  const confirm = useConfirm();
  const activity = useActivity();
  const toast = useToast();
  const { t, formatNumber } = useI18n();
  const isOwner = session.membershipRole === 'OWNER';

  function navigate(nextPage: number, nextPageSize = pageSize, nextSort = sort, nextDirection = direction) { router.replace(catalogueUrl(query, nextPage, nextPageSize, nextSort, nextDirection)); }
  function changePage(nextPage: number) { navigate(nextPage); }
  function changePageSize(nextPageSize: number) { navigate(1, nextPageSize); }
  function submitSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(1); }
  function changeSort(nextSort: CatalogueSort) { navigate(1, pageSize, nextSort, nextSort === sort ? (direction === 'asc' ? 'desc' : 'asc') : naturalDirection(nextSort)); }
  async function clearCatalogue() {
    if (!await confirm({ title: t('catalogue.clearConfirmTitle'), description: t('catalogue.clearConfirmDescription'), confirmLabel: t('catalogue.clearConfirm'), tone: 'danger' })) return;
    setClearing(true);
    try {
      const response = await activity.run(t('catalogue.clearing'), () => mutatingFetch('/api/catalogue', { method: 'DELETE' }));
      const body = await response.json() as { deleted?: number; message?: string; code?: string };
      if (!response.ok) throw body;
      toast.show({ type: 'success', title: t('catalogue.cleared'), message: t('catalogue.deletedCount', { count: formatNumber(body.deleted ?? 0) }) });
      setEditing(null);
      router.replace('/catalogue');
      router.refresh?.();
    } catch (reason) {
      toast.show({ type: 'error', title: t('catalogue.clearFailed'), message: localizeApiError(reason, t) });
    } finally { setClearing(false); }
  }

  return <>
    <div className="catalogue-toolbar">
      <form onSubmit={submitSearch} role="search" data-validation-context="non-field"><label className="sr-only" htmlFor="catalogue-search">{t('catalogue.searchLabel')}</label><input id="catalogue-search" onChange={(event) => setQuery(event.target.value)} placeholder={t('catalogue.searchPlaceholder')} type="search" value={query} /><button className="secondary-button" type="submit">{t('catalogue.search')}</button></form>
      {isOwner && <div className="catalogue-toolbar-actions"><button className="danger-text-button" disabled={clearing || total === 0} onClick={() => void clearCatalogue()} type="button">{clearing ? t('catalogue.clearing') : t('catalogue.clear')}</button><button className="primary-button catalogue-add-button" onClick={() => setEditing('new')} type="button">{t('catalogue.add')}</button></div>}
    </div>
    {editing === 'new' && isOwner && <ProductEditor onClose={() => setEditing(null)} />}
    {editing !== null && editing !== 'new' && isOwner && <ProductEditor onClose={() => setEditing(null)} product={editing} />}
    <MobileSortControl ascendingLabel={t('catalogue.ascending')} descendingLabel={t('catalogue.descending')} direction={direction} label={t('catalogue.sortBy')} onDirectionChange={() => changeSort(sort)} onSortChange={changeSort} options={[{ value: 'sku', label: t('catalogue.sku') }, { value: 'name', label: t('catalogue.name') }, { value: 'price', label: t('catalogue.price') }, { value: 'stock', label: t('catalogue.stock') }, { value: 'status', label: t('catalogue.status') }]} value={sort} />
    {products.length === 0 ? <p className="catalogue-empty" role="status">{search ? t('catalogue.noResults') : t('catalogue.empty')}</p> : <>
      <div className="catalogue-table-wrap"><table className="catalogue-table"><caption className="sr-only">{t('catalogue.tableCaption')}</caption><thead><tr><th className="table-row-index" scope="col">{t('catalogue.number')}</th><SortableHeader active={sort === 'sku'} direction={direction} label={t('catalogue.sku')} onClick={() => changeSort('sku')} /><SortableHeader active={sort === 'name'} direction={direction} label={t('catalogue.name')} onClick={() => changeSort('name')} /><SortableHeader active={sort === 'price'} direction={direction} label={t('catalogue.price')} onClick={() => changeSort('price')} /><SortableHeader active={sort === 'stock'} direction={direction} label={t('catalogue.stock')} onClick={() => changeSort('stock')} /><SortableHeader active={sort === 'status'} direction={direction} label={t('catalogue.status')} onClick={() => changeSort('status')} />{isOwner && <th scope="col"><span className="sr-only">{t('catalogue.actions')}</span></th>}</tr></thead><tbody>{products.map((product, index) => <CatalogueRow isOwner={isOwner} key={product.id ?? product.sku} onEdit={() => setEditing(product)} product={product} rowNumber={rowNumber(page, pageSize, index)} />)}</tbody></table></div>
      <div className="catalogue-cards">{products.map((product, index) => <CatalogueCard isOwner={isOwner} key={product.id ?? product.sku} onEdit={() => setEditing(product)} product={product} rowNumber={rowNumber(page, pageSize, index)} />)}</div>
    </>}
    {total > 0 && <TablePagination ariaLabel={t('catalogue.pages')} onPageChange={changePage} onPageSizeChange={changePageSize} page={page} pageSize={pageSize} total={total} />}
  </>;
}

function CatalogueRow({ product, isOwner, onEdit, rowNumber }: { product: EditableProduct; isOwner: boolean; onEdit: () => void; rowNumber: number }) {
  const { t, formatNumber } = useI18n();
  return <tr><td className="table-row-index">{formatNumber(rowNumber)}</td><td>{product.sku}</td><td><strong>{product.name}</strong>{product.aliases?.length ? <small>{product.aliases.join(', ')}</small> : null}</td><td><PriceLabel product={product} /></td><td>{product.stockQuantity === null || product.stockQuantity === undefined ? '—' : formatNumber(product.stockQuantity)}</td><td><Status active={product.active ?? true} /></td>{isOwner && <td><button className="text-button" onClick={onEdit} type="button">{t('catalogue.edit')}</button></td>}</tr>;
}

function CatalogueCard({ product, isOwner, onEdit, rowNumber }: { product: EditableProduct; isOwner: boolean; onEdit: () => void; rowNumber: number }) {
  const { t, formatNumber } = useI18n();
  return <article className="catalogue-card"><span className="catalogue-card-index">{t('catalogue.number')} {formatNumber(rowNumber)}</span><div><strong>{product.name}</strong><small>{t('catalogue.cardSku', { sku: product.sku })}</small></div><dl><div><dt>{t('catalogue.price')}</dt><dd><PriceLabel product={product} /></dd></div><div><dt>{t('catalogue.stock')}</dt><dd>{product.stockQuantity === null || product.stockQuantity === undefined ? '—' : formatNumber(product.stockQuantity)}</dd></div></dl><div className="catalogue-card-actions"><Status active={product.active ?? true} />{isOwner && <button className="text-button" onClick={onEdit} type="button">{t('catalogue.edit')}</button>}</div></article>;
}

function Status({ active }: { active: boolean }) { const { t } = useI18n(); return <span className={`catalogue-status${active ? ' is-active' : ''}`}>{active ? t('catalogue.active') : t('catalogue.inactive')}</span>; }
function PriceLabel({ product }: { product: EditableProduct }) { const { formatNumber } = useI18n(); return product.price === null || product.price === undefined ? '—' : <>{formatNumber(product.price, { maximumFractionDigits: 2 })}{product.currency ? ` ${product.currency}` : ''}</>; }
function rowNumber(page: number, pageSize: number, index: number) { return (Math.max(1, page) - 1) * pageSize + index + 1; }
function naturalDirection(sort: CatalogueSort): SortDirection { return sort === 'price' || sort === 'stock' ? 'desc' : 'asc'; }
function catalogueUrl(query: string, page: number, pageSize: number, sort: CatalogueSort, direction: SortDirection) { const params = new URLSearchParams(); if (query.trim()) params.set('search', query.trim()); if (sort !== 'name') params.set('sort', sort); if (direction !== 'asc') params.set('direction', direction); if (page > 1) params.set('page', String(page)); if (pageSize !== 25) params.set('pageSize', String(pageSize)); const serialized = params.toString(); return serialized ? `/catalogue?${serialized}` : '/catalogue'; }
