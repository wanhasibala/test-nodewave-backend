import { buildFilterQuery, type FilteringQuery, type QuerySpecification } from '@nodewave/prisma-ezfilter';
import type { Context } from 'hono';

export const parseEzFilterFromContext = (c: Context, defaultSpec?: QuerySpecification) => {
  const queryParams = c.req.query();

  const filter: FilteringQuery = {};

  if (queryParams.filters) {
    try {
      filter.filters = typeof queryParams.filters === 'string' ? JSON.parse(queryParams.filters) : queryParams.filters;
    } catch {
      // Ignored if not JSON
    }
  }

  if (queryParams.searchFilters) {
    try {
      filter.searchFilters = typeof queryParams.searchFilters === 'string' ? JSON.parse(queryParams.searchFilters) : queryParams.searchFilters;
    } catch {
      // Ignored
    }
  }

  if (queryParams.rangedFilters) {
    try {
      filter.rangedFilters = typeof queryParams.rangedFilters === 'string' ? JSON.parse(queryParams.rangedFilters) : queryParams.rangedFilters;
    } catch {
      // Ignored
    }
  }

  if (queryParams.orderKey) {
    filter.orderKey = queryParams.orderKey;
  }

  if (queryParams.orderRule) {
    filter.orderRule = queryParams.orderRule as 'asc' | 'desc';
  }

  if (queryParams.page) {
    filter.page = parseInt(queryParams.page, 10) || 1;
  }

  if (queryParams.rows) {
    filter.rows = parseInt(queryParams.rows, 10) || 10;
  }

  const prismaQuery = buildFilterQuery(filter, defaultSpec);
  const page = filter.page || 1;
  const rows = filter.rows || 10;

  return {
    filter,
    prismaQuery,
    page,
    rows,
  };
};
