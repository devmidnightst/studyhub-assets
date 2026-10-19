# nocturne jsDelivr build

serves nocturne's static assets (css, js, images) via jsDelivr CDN instead of direct VPS delivery. HTML pages still serve from nocturne.lol; the proxy engine (`/app/`, `/sapphire/`) stays same-origin as required for service workers.

## how it works

jsDelivr mirrors GitHub repos at:
```
https://cdn.jsdelivr.net/gh/USER/REPO@TAG/path/to/file
```

this build rewrites every `/src/css/`, `/src/js/`, `/src/img/`, `/src/lib/` reference in the HTML files to that CDN URL.

## usage

### 1. build

```bash
cd /var/www/nocturne/build/jsdelivr
./jsd-build.sh --repo YOUR_GH_USER/nocturne-cdn --tag v1.0.0
```

outputs to `out/`:
- `out/assets-repo/` — push this to GitHub
- `out/dist-html/` — deploy these HTML files to the VPS

### 2. push assets to github

```bash
cd out/assets-repo
git init -b main
git remote add origin git@github.com:YOUR_GH_USER/nocturne-cdn.git
git add .
git commit -m "nocturne cdn assets v1.0.0"
git tag v1.0.0
git push origin main --tags
```

wait ~2 min for jsDelivr to mirror, then verify:
```
https://cdn.jsdelivr.net/gh/YOUR_GH_USER/nocturne-cdn@v1.0.0/src/css/global.css
```

### 3. deploy HTML to VPS

copy `out/dist-html/*.html` over your live `public/*.html`:
```bash
cp out/dist-html/*.html /var/www/nocturne/public/
```

or use jsd-deploy.sh (handles both steps):
```bash
SSH_TARGET=user@nocturne.lol ./jsd-deploy.sh --repo YOUR_GH_USER/nocturne-cdn --tag v1.0.0
```

## updating

bump the tag each deploy so jsDelivr serves fresh files (CDN caches by tag):
```bash
./jsd-build.sh --repo YOUR_GH_USER/nocturne-cdn --tag v1.1.0
```

## what stays on the VPS

| path | why |
|------|-----|
| `/app/` | proxy engine — service workers must be same-origin |
| `/sapphire/` | proxy SW — same-origin |
| `/controller/` | scramjet controller — same-origin |
| `/api/*` | backend API calls |
| `*.html` | server-rendered, patched to point at CDN |
