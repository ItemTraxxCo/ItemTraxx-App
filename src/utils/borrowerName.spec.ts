import { describe, expect, it } from 'vitest';
import { borrowerDisplayName, normalizeBorrowerName } from './borrowerName';

describe('borrower name', () => {
  it('joins first and last names, and supports a single free input', () => {
    expect(borrowerDisplayName({ first_name: 'Ada', last_name: 'Lovelace', username: 'old' })).toBe('Ada Lovelace');
    expect(borrowerDisplayName({ first_name: 'Library Cart', last_name: null, username: 'old' })).toBe('Library Cart');
    expect(borrowerDisplayName({ username: 'legacy' })).toBe('legacy');
  });
  it('rejects blank required names and normalizes optional last names', () => {
    expect(() => normalizeBorrowerName('   ', 'Smith')).toThrow();
    expect(normalizeBorrowerName(' Ada ', '   ')).toEqual({ first_name: 'Ada', last_name: null });
    expect(normalizeBorrowerName(' Ada ', ' Lovelace ')).toEqual({ first_name: 'Ada', last_name: 'Lovelace' });
  });
});

it('sorts decrypted records by resolved display name without changing the input', async () => {
  const { sortBorrowersByName } = await import('./borrowerName');
  const rows = [{ first_name: 'Zoe', username: '' }, { first_name: 'Alice', last_name: 'Smith', username: '' }, { first_name: 'Maya', username: '' }];
  expect(sortBorrowersByName(rows).map((row) => row.first_name)).toEqual(['Alice', 'Maya', 'Zoe']);
  expect(rows[0].first_name).toBe('Zoe');
});
