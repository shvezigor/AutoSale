'use client';

import { useI18n } from '../i18n/i18n-provider';

type TablePaginationProps = {
  ariaLabel: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const PAGE_SIZES = [10, 25, 50, 100];

export function TablePagination({ ariaLabel, page, pageSize, total, onPageChange, onPageSizeChange }: TablePaginationProps) {
  const { t, formatNumber } = useI18n();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const firstRow = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, total);

  return <nav aria-label={ariaLabel} className="table-pagination">
    <div className="table-pagination-summary"><span>{t('pagination.rowsSummary', { first: formatNumber(firstRow), last: formatNumber(lastRow), total: formatNumber(total) })}</span><label>{t('pagination.rowsPerPage')}<select aria-label={t('pagination.rowsPerPage')} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{formatNumber(size)}</option>)}</select></label></div>
    <div className="table-pagination-pages">
      <button aria-label={t('pagination.previous')} disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} type="button">‹</button>
      {visiblePages(safePage, pageCount).map((item, index) => item === 'ellipsis' ? <span aria-hidden="true" className="table-pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button aria-current={item === safePage ? 'page' : undefined} aria-label={t('pagination.page', { page: formatNumber(item) })} className={item === safePage ? 'is-current' : undefined} key={item} onClick={() => onPageChange(item)} type="button">{formatNumber(item)}</button>)}
      <button aria-label={t('pagination.next')} disabled={safePage >= pageCount} onClick={() => onPageChange(safePage + 1)} type="button">›</button>
    </div>
  </nav>;
}

function visiblePages(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'ellipsis', pageCount];
  if (page >= pageCount - 3) return [1, 'ellipsis', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', pageCount];
}
