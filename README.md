# Chatwoot Freemius Customer Portal

A small Chatwoot dashboard app that lets an agent enter a customer email address, choose a Freemius product, generate a customer portal magic link, and open the portal in a new tab.

## Freemius Flow

The app follows Freemius' hosted customer portal SSO flow:

1. The React app posts the customer email and selected product ID to `/api/generate-magic-link`.
2. The Vite server middleware validates the product ID against the local product map.
3. The Vite server middleware reads that product's server-side bearer token.
4. The Vite server middleware calls Freemius with the selected product ID and token.
5. Freemius returns a short-lived customer portal link.
6. The browser opens the returned link immediately.

Supported products live in `shared/freemiusProducts.ts`:

| Product | Freemius product ID | Bearer token env var |
| --- | --- | --- |
| Frame Maker | `289295` | `FREEMIUS_FRAME_MAKER_BEARER_TOKEN` |
| Image Blend | `452236` | `FREEMIUS_IMAGE_BLEND_BEARER_TOKEN` |
| Collage Maker | `22331` | `FREEMIUS_COLLAGE_MAKER_BEARER_TOKEN` |
| Type Warp | `27131` | `FREEMIUS_TYPE_WARP_BEARER_TOKEN` |

Freemius notes that portal magic links should be generated on click because they expire quickly.

## Setup

Copy `.env.example` to `.env` and fill in the required values:

```bash
FREEMIUS_FRAME_MAKER_BEARER_TOKEN=your_frame_maker_bearer_token
FREEMIUS_IMAGE_BLEND_BEARER_TOKEN=your_image_blend_bearer_token
FREEMIUS_COLLAGE_MAKER_BEARER_TOKEN=your_collage_maker_bearer_token
FREEMIUS_TYPE_WARP_BEARER_TOKEN=your_type_warp_bearer_token
```

Restart the Vite dev server after changing `.env`; Vite reads these files at startup.

Optional hardening:

```bash
PORTAL_ACCESS_TOKEN=choose-a-long-random-token
```

When `PORTAL_ACCESS_TOKEN` is set, register the Chatwoot dashboard app URL with the same token:

```text
https://your-app.example.com/?access_token=choose-a-long-random-token
```

The React app stores the token in `sessionStorage`, removes it from the visible URL after loading, and sends it only as the `X-Portal-Access-Token` header.
The UI stays locked until `/api/auth-status` verifies the token, so the email/product form is not rendered for unauthorized visitors.

To send customers to a specific Freemius portal section, set a store path:

```bash
FREEMIUS_PORTAL_NEXT_PATH=/store/123/subscriptions
```

## Run

```bash
npm install
npm run dev
```

Open the shown local URL and submit a Freemius customer email.

## Build

```bash
npm run build
npm run preview
```

The `/api/generate-magic-link` and `/api/auth-status` routes are available in two places:

- Local Vite dev/preview uses `server/freemiusPortal.ts` middleware.
- Vercel production uses the serverless functions in `api/`.

Keep all Freemius bearer tokens and `PORTAL_ACCESS_TOKEN` in Vercel environment variables.
