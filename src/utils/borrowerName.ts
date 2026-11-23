export type BorrowerName = { first_name?: string | null; last_name?: string | null; display_name?: string | null; username?: string | null };

export const borrowerDisplayName = (borrower: BorrowerName): string => {
  const first = borrower.first_name?.trim();
  if (first) return [first, borrower.last_name?.trim()].filter(Boolean).join(' ');
  return borrower.display_name?.trim() || borrower.username?.trim() || '';
};

export const normalizeBorrowerName = (first: string, last: string) => {
  const first_name = first.trim();
  if (!first_name) throw new Error('Enter a borrower name.');
  return { first_name, last_name: last.trim() || null };
};

export const sortBorrowersByName = <T extends BorrowerName>(borrowers: readonly T[]): T[] =>
  [...borrowers].sort((a, b) => borrowerDisplayName(a).localeCompare(borrowerDisplayName(b), undefined, { sensitivity: 'base', numeric: true }));
