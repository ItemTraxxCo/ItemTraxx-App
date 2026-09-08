/**
 * Remove only slash characters at the end of a URL base.
 *
 * Scan backwards once instead of using a regex so the operation remains
 * linear even when the configured value is unexpectedly large.
 */
export const trimTrailingSlash = (value: string) => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
};
