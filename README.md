# Receipts

Small iPhone PWA to scan receipts, flatten them into PDFs and email them in batches to a bookkeeper.
No backend, no third-party scripts. Everything stays on the phone until you share it.

Files: `index.html`, `app.js` (UI), `crop.js` (corner cropper), `warp.js` (perspective flatten + contrast), `pdf.js` (PDF writer), `db.js` (IndexedDB), `lock.js` (Face ID via passkey), `sw.js` (offline).

After changing any file, bump `CACHE` in `sw.js` so installed copies update.

Local test: `npx http-server . -p 8099` then open http://localhost:8099
Install on iPhone: open the HTTPS URL in Safari, Share, Add to Home Screen.
