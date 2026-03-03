# Offline Queue Design

## Problem
Checkout/return operations should not be lost when network connectivity drops.

## Solution
Client-side offline buffer with automatic sync when connectivity returns.

## Data Model
Each queued entry stores:
- `id` (client-generated)
- `type` (`checkout` or `return`)
- payload
- enqueue timestamp
- retry count
- last error (optional)

## Storage
- Persist queue in local storage.
- Keep bounded size to avoid unbounded growth.

## Sync Strategy
1. Attempt immediate send when online.
2. If request fails due to network, enqueue.
3. On reconnect, flush queue in FIFO order.
4. Remove item only after confirmed success.

## UX
- Top-right menu queue indicator: `Offline Queue: X`.
- Tooltip explains buffered actions and auto-sync behavior.
- User feedback on sync success/failure.

## Failure Handling
- Exponential retry/backoff for transient failures.
- Stop retry on non-retryable 4xx and surface explicit error.
- Keep idempotency in server handlers where possible.
