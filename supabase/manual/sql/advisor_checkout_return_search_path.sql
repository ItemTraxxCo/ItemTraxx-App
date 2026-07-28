-- The legacy SQL checkout_return RPC has been retired. Checkout and quick
-- return run through the authenticated checkoutReturn Edge Function, which
-- enforces workspace roles, access grants, idempotency, and audit semantics.
-- Keep this advisor repair file safe to run against older environments.
drop function if exists public.checkout_return(text, text[], text);
