import { optionalText, ValidationError } from "./validation.ts";

const SAFE_POSTGREST_SEARCH_PATTERN = /^[\p{L}\p{N}\s@._+\-'&/]+$/u;
const POSTGREST_FILTER_META_PATTERN = /[,()%"]/;

export const optionalPostgrestSearchText = (
  value: unknown,
  options: { maxLen?: number } = {},
) => {
  const search = optionalText(value, {
    maxLen: options.maxLen ?? 120,
    pattern: SAFE_POSTGREST_SEARCH_PATTERN,
  });
  if (search && POSTGREST_FILTER_META_PATTERN.test(search)) {
    throw new ValidationError("Search contains unsupported characters.");
  }
  return search;
};
