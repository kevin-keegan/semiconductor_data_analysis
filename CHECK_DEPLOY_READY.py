from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parent
LIMIT = 95 * 1024 * 1024

required = [
    ROOT / "backend" / "main.py",
    ROOT / "frontend" / "index.html",
    ROOT / "Dockerfile",
    ROOT / "wrangler.jsonc",
    ROOT / "src" / "index.js",
    ROOT / "requirements.txt",
    ROOT / "R2_FILES.json",
]

ok = True

for p in required:
    if p.exists():
        print("PASS:", p.relative_to(ROOT))
    else:
        ok = False
        print("FAIL missing:", p.relative_to(ROOT))

large = []
for p in ROOT.rglob("*"):
    if not p.is_file():
        continue
    if ".git" in p.parts or "node_modules" in p.parts:
        continue
    if p.stat().st_size >= LIMIT:
        large.append((p, p.stat().st_size))

if large:
    ok = False
    print("\nFAIL: GitHub-sized files still present:")
    for p, size in large:
        print(f"  {p.relative_to(ROOT)}  {size/1024/1024:.1f} MiB")
else:
    print("\nPASS: no repository file >= 95 MiB")

cfg = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
if "REPLACE_WITH_CLOUDFLARE_ACCOUNT_ID" in cfg:
    print("\nTODO: replace R2_ACCOUNT_ID in wrangler.jsonc")
else:
    print("\nPASS: Cloudflare account id placeholder replaced")

manifest = json.loads((ROOT / "R2_FILES.json").read_text(encoding="utf-8"))
print(f"R2 files: {len(manifest.get('files', []))}")
for x in manifest.get("files", []):
    print(f"  - {x['r2_key']} ({x['size_mb']} MiB)")

print("\nRESULT:", "PASS" if ok else "CHECK TODO/FAIL ITEMS ABOVE")
sys.exit(0 if ok else 1)
