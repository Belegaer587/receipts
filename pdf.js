// Tiny PDF writer: one JPEG per page, no dependencies.
// pages: [{ jpeg: Uint8Array, w: number, h: number }]
export function buildPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let len = 0;
  const push = (d) => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(b);
    len += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));

  pages.forEach((p, i) => {
    const page = 3 + 3 * i, content = page + 1, img = page + 2;
    const sc = 842 / Math.max(p.w, p.h);
    const pw = (p.w * sc).toFixed(2), ph = (p.h * sc).toFixed(2);
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`));
    const stream = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(content, () => push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    obj(img, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });

  const total = 3 + 3 * pages.length;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
