# EarthRe deployment checklist

## 1. Create D1

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 create earthre-sla
```

Copy the returned `database_id` into `wrangler.toml`.

## 2. Apply schema

```powershell
npx wrangler d1 execute earthre-sla --remote --file=schema.sql
```

## 3. Deploy API

```powershell
npm run deploy
```

Test:

```powershell
curl https://YOUR-WORKER.workers.dev/api/health
```

## 4. Deploy frontend

```powershell
cd ../web
npm install
$env:VITE_API_URL="https://YOUR-WORKER.workers.dev"
npm run build
```

Deploy the generated `dist` directory using Cloudflare Pages.

## 5. Verify

- Open the Pages URL.
- Upload one supplied CSV.
- Confirm the processing message appears.
- Confirm statistics update.
- Confirm logs are visible.
- Test a single date and a date range.
- Open `/api/health` directly.
- Record the live URLs and verification date in README.md.
