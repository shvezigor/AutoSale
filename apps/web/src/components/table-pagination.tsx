'use client';

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
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const firstRow = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, total);

  return <nav aria-label={ariaLabel} className="table-pagination">
    <div className="table-pagination-summary"><span>{firstRow}–{lastRow} із {total}</span><label>Рядків на сторінці<select aria-label="Рядків на сторінці" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
    <div className="table-pagination-pages">
      <button aria-label="Попередня сторінка" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} type="button">‹</button>
      {visiblePages(safePage, pageCount).map((item, index) => item === 'ellipsis' ? <span aria-hidden="true" className="table-pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button aria-current={item === safePage ? 'page' : undefined} aria-label={`Сторінка ${item}`} className={item === safePage ? 'is-current' : undefined} key={item} onClick={() => onPageChange(item)} type="button">{item}</button>)}
      <button aria-label="Наступна сторінка" disabled={safePage >= pageCount} onClick={() => onPageChange(safePage + 1)} type="button">›</button>
    </div>
  </nav>;
}

function visiblePages(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'ellipsis', pageCount];
  if (page >= pageCount - 3) return [1, 'ellipsis', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', pageCount];
}
