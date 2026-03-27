# ItemTraxx Kill Switch Runbook

This is the quick procedure to enable or disable the production kill switch.

## What It Does

- Blocks app function traffic in production (through Cloudflare edge proxy).
- Shows a full-screen "ItemTraxx Temporarily Unavailable" overlay in the app.
- `system-status` stays available.
- Localhost/private LAN testing origins are bypassed.

## Enable Kill Switch

1. Set Supabase function secret to `true`:

```bash
cd "$(git rev-parse --show-toplevel)"
supabase secrets set ITX_ITEMTRAXX_KILLSWITCH_ENABLED=true
```

2. Deploy Cloudflare worker with kill switch enabled:

```bash
cd "$(git rev-parse --show-toplevel)/cloudflare/edge-proxy"
wrangler deploy --var ITX_ITEMTRAXX_KILLSWITCH_ENABLED:true
```

## Disable Kill Switch

1. Set Supabase function secret to `false`:

```bash
cd "$(git rev-parse --show-toplevel)"
supabase secrets set ITX_ITEMTRAXX_KILLSWITCH_ENABLED=false
```

2. Deploy Cloudflare worker with kill switch disabled:

```bash
cd "$(git rev-parse --show-toplevel)/cloudflare/edge-proxy"
wrangler deploy --var ITX_ITEMTRAXX_KILLSWITCH_ENABLED:false
```

## Verification

- Check `https://edge.itemtraxx.com/functions/system-status` and confirm:
  - `kill_switch.enabled: true` when enabled.
  - `kill_switch.enabled: false` when disabled.
- UI checks status every 5 minutes; hard refresh to see changes immediately.

## Notes

- Keep Supabase and Cloudflare values in sync.
- If only one side is toggled, behavior can be inconsistent.
