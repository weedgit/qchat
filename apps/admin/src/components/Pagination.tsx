"use client";

import { useLocale } from "@/lib/locale";

type Props = {
  total: number;
  offset: number;
  pageSize: number;
  /** Rows returned on the current page (may be less than pageSize on the last page). */
  visibleCount: number;
  loading?: boolean;
  onPageChange: (offset: number) => void;
  emptyLabel?: string;
};

export default function Pagination({
  total,
  offset,
  pageSize,
  visibleCount,
  loading = false,
  onPageChange,
  emptyLabel,
}: Props) {
  const { t } = useLocale();

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize) + 1;
  const from = total === 0 ? 0 : offset + 1;
  const to = total === 0 ? 0 : Math.min(offset + visibleCount, total);
  const canPrev = !loading && offset > 0;
  const canNext = !loading && offset + pageSize < total;
  const showNav = total > pageSize;

  if (total === 0 && visibleCount === 0) {
    return emptyLabel ? (
      <div className="pagination">
        <span className="muted">{emptyLabel}</span>
      </div>
    ) : null;
  }

  const effectiveTotal = total > 0 ? total : visibleCount;

  return (
    <div className="pagination">
      <span className="pagination-summary">
        {t("admin.common.showing", {
          from: effectiveTotal === 0 ? 0 : offset + 1,
          to: Math.min(offset + visibleCount, effectiveTotal),
          total: effectiveTotal,
        })}
      </span>

      {showNav ? (
        <div className="pagination-actions" role="navigation" aria-label="Pagination">
          <button
            type="button"
            className="pagination-btn"
            disabled={!canPrev}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
          >
            {t("admin.common.previous")}
          </button>
          <span className="pagination-page">{t("admin.common.pageIndicator", { page, pages })}</span>
          <button
            type="button"
            className="pagination-btn"
            disabled={!canNext}
            onClick={() => onPageChange(offset + pageSize)}
          >
            {t("admin.common.next")}
          </button>
        </div>
      ) : (
        <span className="pagination-page muted">
          {t("admin.common.pageIndicator", { page: 1, pages: 1 })}
        </span>
      )}
    </div>
  );
}
