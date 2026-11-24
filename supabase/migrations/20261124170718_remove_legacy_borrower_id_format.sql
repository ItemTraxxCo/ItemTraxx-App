-- Some production databases retained this constraint from the archived setup.
-- Borrower IDs are freeform; encrypted records store the ID only in ciphertext.
alter table public.borrowers drop constraint if exists borrowers_borrower_id_format_check;
