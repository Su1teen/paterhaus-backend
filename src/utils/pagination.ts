export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export interface PaginationInput {
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export function resolvePagination({ page, limit }: PaginationInput): Pagination {
  const safePage = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : DEFAULT_PAGE;
  const requestedLimit =
    Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : DEFAULT_LIMIT;
  const safeLimit = Math.min(requestedLimit, MAX_LIMIT);

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  };
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function buildMeta(pagination: Pagination, total: number): PaginatedMeta {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
  };
}
