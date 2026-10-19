# Backdrop plush images

These images are embedded into the **Miku** and **Teto** backdrops (a soft, glowing
plush in the bottom-right corner, behind the particle stream).

The `.svg` files here are placeholder chibi drawings. To use your own plush photos
instead, just drop a PNG next to them with the matching name — no code changes:

- `miku-plush.png`  → used by the Miku backdrop
- `teto-plush.png`  → used by the Teto backdrop

The backdrop loads the `.png` if it exists and falls back to the bundled `.svg`
placeholder otherwise. Transparent PNGs (cut-out plush) look best; square-ish
images around 600×600+ work well. After adding a file, hard-refresh (Ctrl+Shift+R).
