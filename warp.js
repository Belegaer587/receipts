// Perspective-flatten the quadrilateral chosen by the user into a straight rectangle.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Solve A x = b (8x8) by Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// pts: [tl, tr, br, bl] in source pixels. Returns a canvas.
export function warp(src, pts, { maxSide = 1600, enhance = true } = {}) {
  const [tl, tr, br, bl] = pts;
  const w = Math.max(dist(tl, tr), dist(bl, br));
  const h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(w, h));
  const W = Math.max(2, Math.round(w * s)), H = Math.max(2, Math.round(h * s));

  // Homography from destination rectangle to source quad.
  const dst = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [X, Y] = pts[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const [a, bb, c, d, e, f, g, hh] = solve(A, b);

  const sctx = src.getContext('2d', { willReadFrequently: true });
  const sd = sctx.getImageData(0, 0, src.width, src.height);
  const sw = src.width, sh = src.height, sp = sd.data;

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const od = octx.createImageData(W, H);
  const op = od.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = g * x + hh * y + 1;
      const X = (a * x + bb * y + c) / k, Y = (d * x + e * y + f) / k;
      const o = (y * W + x) * 4;
      if (X < 0 || Y < 0 || X >= sw - 1 || Y >= sh - 1) { op[o] = op[o + 1] = op[o + 2] = 255; op[o + 3] = 255; continue; }
      const x0 = X | 0, y0 = Y | 0, fx = X - x0, fy = Y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        op[o + ch] = (sp[i00 + ch] * (1 - fx) + sp[i10 + ch] * fx) * (1 - fy) + (sp[i01 + ch] * (1 - fx) + sp[i11 + ch] * fx) * fy;
      }
      op[o + 3] = 255;
    }
  }

  if (enhance) levels(op);
  octx.putImageData(od, 0, 0);
  return out;
}

// Stretch contrast: paper becomes white, ink stays dark. Same mapping on all channels keeps colour.
function levels(p) {
  const hist = new Uint32Array(256);
  const n = p.length / 4;
  for (let i = 0; i < p.length; i += 4) hist[(p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0]++;
  const pct = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; } return 255; };
  const black = pct(0.01), white = pct(0.8);
  if (white - black < 40) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - black) / (white - black)) * 255;
  for (let i = 0; i < p.length; i += 4) { p[i] = lut[p[i]]; p[i + 1] = lut[p[i + 1]]; p[i + 2] = lut[p[i + 2]]; }
}
