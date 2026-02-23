# Frontend Performance Deep Pass (2026-02-23)

## Changes
- Converted PDF export dependencies to lazy-loaded runtime imports:
  - `/src/services/exportService.ts`
  - `/src/services/barcodePdfService.ts`
- Updated all PDF export call sites to async handlers.
- Added bundle budgets and perf reporting scripts:
  - `npm run perf:budget`
  - `npm run perf:report`
- Added CI enforcement in `ci-core.yml` for bundle budget + artifact report.

## Impact
- Initial app payload no longer eagerly includes heavy PDF generation code paths.
- PDF/vendor chunk remains large but is now loaded on-demand only.
- CI now blocks regressions when main/landing chunks exceed budget thresholds.

## Current Budget Thresholds
- Main app chunk (`index-*.js`): <= 40 KB
- Landing chunk (`PublicHome-*.js`): <= 20 KB

## Next Optimization Targets
- Move client-side barcode generation into a web worker.
- Trim or replace heavy PDF stack if feature usage remains low.
- Add RUM-based performance budget from real production sessions.
