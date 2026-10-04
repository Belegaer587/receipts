// Manual corner cropper drawn on a canvas.
export async function loadSource(file, maxSide = 2400) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

export function createCropper(canvas, src) {
  const ctx = canvas.getContext('2d');
  const ac = new AbortController();
  const dpr = window.devicePixelRatio || 1;
  let cw = 0, ch = 0, scale = 1, ox = 0, oy = 0, pts = [], drag = -1;

  function reset() {
    const mx = src.width * 0.06, my = src.height * 0.06;
    pts = [[mx, my], [src.width - mx, my], [src.width - mx, src.height - my], [mx, src.height - my]];
    draw();
  }

  function layout() {
    const r = canvas.parentElement.getBoundingClientRect();
    cw = r.width; ch = r.height;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    scale = Math.min((cw - 40) / src.width, (ch - 40) / src.height);
    ox = (cw - src.width * scale) / 2;
    oy = (ch - src.height * scale) / 2;
    draw();
  }

  const toScreen = (p) => [ox + p[0] * scale, oy + p[1] * scale];

  function draw() {
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(src, ox, oy, src.width * scale, src.height * scale);
    const q = pts.map(toScreen);
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.moveTo(...q[0]); q.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.moveTo(...q[0]); q.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath();
    ctx.strokeStyle = '#4c9aff'; ctx.lineWidth = 2; ctx.stroke();
    for (const p of q) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(76,154,255,.35)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    let best = -1, bd = 48;
    pts.forEach((p, i) => { const s = toScreen(p), d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = best; canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
  }, { signal: ac.signal });

  canvas.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const [x, y] = local(e);
    pts[drag] = [
      Math.min(src.width, Math.max(0, (x - ox) / scale)),
      Math.min(src.height, Math.max(0, (y - oy) / scale)),
    ];
    draw();
  }, { signal: ac.signal });

  const end = () => { drag = -1; };
  canvas.addEventListener('pointerup', end, { signal: ac.signal });
  canvas.addEventListener('pointercancel', end, { signal: ac.signal });
  window.addEventListener('resize', layout, { signal: ac.signal });

  pts = [];
  reset();
  return { layout, reset, points: () => pts.map((p) => [...p]), destroy: () => ac.abort() };
}
