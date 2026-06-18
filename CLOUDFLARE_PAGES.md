# MASEST Cloudflare Pages

Production Pages URL: `https://masest-commerce.pages.dev/`
Custom domain: `https://masest.co/`

Cloudflare Pages project:

- Project name: `masest-commerce`
- Production branch: `netlify-commerce`
- Static publish root: repository root as deployed by the Pages project
- Pages Functions: `functions/` routes `/api/*`

## DNS

`masest.co` uses Cloudflare nameservers. The Pages project must have
`masest.co` added under Workers & Pages -> `masest-commerce` -> Custom domains.

The Cloudflare DNS zone must also contain:

| Type | Name | Target |
| --- | --- | --- |
| `CNAME` | `@` | `masest-commerce.pages.dev` |
| `CNAME` | `www` | `masest-commerce.pages.dev` |

Cloudflare supports CNAME flattening at the zone apex, so `@` can be a CNAME.
Do not use GitHub Pages `A` records and do not commit a `CNAME` file for this
site.

## Required Env Vars

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_URL=https://masest.co`
- `RESEND_API_KEY`
- `RESEND_FROM=MASEST Orders <orders@send.masest.co>`
- `ORDER_NOTIFY_EMAIL`
- `KLAVIYO_PRIVATE_KEY`
- `KLAVIYO_LIST_ID`

After env var changes, retry a production deployment so the new values bind.

## Verify

```bash
dig +short masest.co CNAME
dig +short www.masest.co CNAME
curl -I https://masest.co/
curl -s https://masest.co/api/health | python3 -m json.tool
curl -s "https://masest.co/api/products?cb=$(date +%s)"
```
