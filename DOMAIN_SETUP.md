## Custom Domain Setup for `petprojectclub.me`

This site is deployed with GitHub Pages through the workflow in [.github/workflows/deploy-pages.yml](/C:/Users/ikotelnikov/Documents/GitHub/pet-project-club-web-site/.github/workflows/deploy-pages.yml).

Because Pages is deployed through a custom GitHub Actions workflow, the custom domain must be configured in GitHub repository settings. A committed `CNAME` file is not the source of truth here.

### Target

- canonical domain: `https://petprojectclub.me`
- redirect alias: `https://www.petprojectclub.me`

### Best-practice sequence

1. In GitHub, verify the domain `petprojectclub.me` for your account.
2. In GitHub repository settings, configure `petprojectclub.me` as the custom domain for Pages.
3. In Namespace DNS, point the apex domain and `www` to GitHub Pages.
4. Wait for DNS to propagate.
5. In GitHub Pages settings, enable `Enforce HTTPS`.

### GitHub steps

1. Open the repository on GitHub.
2. Go to `Settings -> Pages`.
3. In `Custom domain`, enter `petprojectclub.me` and save.
4. After DNS is live and GitHub finishes certificate provisioning, enable `Enforce HTTPS`.

Recommended account-level hardening:

1. Open GitHub `Settings -> Pages`.
2. Verify the domain `petprojectclub.me`.

### Namespace DNS records

Create or update these records for the root domain:

- `A` `@` -> `185.199.108.153`
- `A` `@` -> `185.199.109.153`
- `A` `@` -> `185.199.110.153`
- `A` `@` -> `185.199.111.153`

If Namespace supports IPv6 records, also add:

- `AAAA` `@` -> `2606:50c0:8000::153`
- `AAAA` `@` -> `2606:50c0:8001::153`
- `AAAA` `@` -> `2606:50c0:8002::153`
- `AAAA` `@` -> `2606:50c0:8003::153`

For the `www` alias, add:

- `CNAME` `www` -> `ikotelnikov.github.io`

### DNS notes

- Do not use wildcard DNS records like `*.petprojectclub.me`.
- Remove conflicting old `A`, `AAAA`, `ALIAS`, `ANAME`, or `CNAME` records for `@` and `www`.
- If Namespace supports `ALIAS` or `ANAME` at the apex and you prefer that, point `@` to `ikotelnikov.github.io` instead of the four `A` records.

### Bot config after cutover

The Telegram bot can generate links back to the public site. Set:

- `PUBLIC_SITE_BASE_URL=https://petprojectclub.me`

Apply that both:

- locally in `bot/local-env.ps1`
- in Cloudflare Worker vars

### Verification checklist

- `https://petprojectclub.me/` loads successfully
- `https://www.petprojectclub.me/` redirects to the canonical domain or serves the same site
- GitHub Pages shows the custom domain as active
- `Enforce HTTPS` is enabled
- bot-generated links use `https://petprojectclub.me`
