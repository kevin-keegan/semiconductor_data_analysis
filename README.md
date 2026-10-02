# EPA · Etch Process Analysis

Cloudflare deployment package generated from the local EPA dashboard.

## Architecture

```text
GitHub
  └─ EPA source + small runtime data
        ↓
Cloudflare Worker
        ↓
Cloudflare Container (existing FastAPI EPA backend)
        ↓
Cloudflare R2 mounted read-only
        └─ large raw OES Day_*.nc files
```

This uses a **Cloudflare Container**, not a plain Python Worker, because the EPA backend
uses a normal Linux/Python stack including NumPy/scikit-learn, NetCDF and filesystem access.

Large raw OES NetCDF files are intentionally excluded from GitHub.

## Cost note

Cloudflare Containers require the **Workers Paid** plan.
If you need a completely free deployment, use a separate precomputed/static architecture instead.

## 1. Check the generated repository

```powershell
py .\CHECK_DEPLOY_READY.py
```

The `R2_ACCOUNT_ID` warning is expected until Cloudflare is configured.

## 2. Install prerequisites

Install:

- Git
- Node.js
- Docker Desktop
- rclone

Then:

```powershell
npm install
npx wrangler login
```

## 3. Create R2 bucket

```powershell
npx wrangler r2 bucket create epa-data
```

Large files are listed in `R2_FILES.json`.

For multi-hundred-MB OES files, use rclone. Configure an R2 remote named `r2`, then:

```powershell
.\UPLOAD_R2.ps1
```

Expected layout:

```text
epa-data/
└─ measurement/
   ├─ Day_2024_07_02.nc
   ├─ Day_2024_07_05.nc
   ├─ ...
   └─ Day_2024_08_22.nc
```

## 4. Cloudflare account ID

Open `wrangler.jsonc` and replace:

```text
REPLACE_WITH_CLOUDFLARE_ACCOUNT_ID
```

with your Cloudflare Account ID.

## 5. R2 API credentials

Cloudflare Dashboard → R2 → Manage R2 API Tokens.

Create S3-compatible access credentials.

Never commit them.

```powershell
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

## 6. Local Docker check

```powershell
docker build -t epa-local .
docker run --rm -p 8080:8080 epa-local
```

Open:

```text
http://localhost:8080
```

Without R2 credentials, raw-OES pages may be unavailable locally.

## 7. GitHub

Create an empty repository, for example:

```text
EPA-Etch-Process-Analysis
```

Then run in this generated folder:

```powershell
git init
git add .
git status
git commit -m "Initial EPA Cloudflare deployment"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_ID/EPA-Etch-Process-Analysis.git
git push -u origin main
```

## 8. First Cloudflare deployment

Docker Desktop must be running.

```powershell
npx wrangler deploy
```

Then:

```powershell
npx wrangler containers list
```

The URL will look like:

```text
https://epa-etch-process-analysis.<workers-subdomain>.workers.dev
```

## 9. Custom domain

Cloudflare Dashboard → Workers & Pages → EPA Worker → Settings / Domains & Routes → Add Custom Domain.

Example:

```text
epa.yourdomain.com
```

## Important

Never commit:

- raw OES `Day_*.nc`
- `.venv`
- credentials
- local backups

Use `R2_FILES.json` to see which files were moved out of GitHub.
