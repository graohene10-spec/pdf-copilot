// Synthetic PDFs only. No external files or personal document content.
export function samplePdf(count = 2, mixedSizes = false, navigation = false, options = {}) {
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  add(''); add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = [];
  for (let page = 1; page <= count; page++) {
    const width = mixedSizes && page % 3 === 0 ? 650 : 500;
    const height = mixedSizes && page % 3 === 0 ? 500 : 650;
    const escape = text => text.replace(/([\\()])/g, '\\$1');
    const lines = options.lines?.[page] || [`Synthetic page ${page}`];
    const drawing = lines.map((text, index) => `BT /F1 ${options.lines ? 16 : 22} Tf 45 ${height - 80 - index * 28} Td (${escape(text)}) Tj ET`).join('\n') + '\n1 0 0 rg 45 200 180 100 re f';
    const content = add(`<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`);
    pages.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  let outline = '';
  if (navigation && count >= 2) {
    const outlineId = objects.length + 1, itemId = outlineId + 1;
    add(`<< /Type /Outlines /First ${itemId} 0 R /Last ${itemId} 0 R /Count 1 >>`);
    add(`<< /Title (Second page) /Parent ${outlineId} 0 R /Dest [${pages[1]} 0 R /Fit] >>`);
    const linkId = add(`<< /Type /Annot /Subtype /Link /Rect [45 530 260 580] /Border [0 0 0] /Dest [${pages[1]} 0 R /Fit] >>`);
    objects[pages[0] - 1] = objects[pages[0] - 1].slice(0, -2) + ` /Annots [${linkId} 0 R] >>`;
    outline = ` /Outlines ${outlineId} 0 R`;
  }
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${outline}${options.labels ? ' /PageLabels << /Nums [0 << /S /r >> 1 << /S /D /St 1 >>] >>' : ''} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count ${count} >>`;
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

// A mixed page (text, a pale rule and fill, a colour photo, a vector red box) and a scanned page
// (one grey image of "printed lines" over the whole page). Images are ASCII-hex so the file stays text.
export function imagePdf() {
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  add(''); add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const hex = bytes => Buffer.from(bytes).toString('hex') + '>';
  const photoBytes = [];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) photoBytes.push(220 - x * 2, 40 + y * 3, 30 + x * 3);
  const photo = add(`<< /Type /XObject /Subtype /Image /Width 64 /Height 48 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${photoBytes.length * 2 + 1} >>\nstream\n${hex(photoBytes)}\nendstream`);
  const scanBytes = [];
  for (let y = 0; y < 260; y++) for (let x = 0; x < 200; x++) scanBytes.push(y % 14 < 5 && x > 16 && x < 184 && (x * 7 + y) % 23 > 4 ? 40 : 246);
  const scan = add(`<< /Type /XObject /Subtype /Image /Width 200 /Height 260 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${scanBytes.length * 2 + 1} >>\nstream\n${hex(scanBytes)}\nendstream`);
  const mixed = ['BT /F1 18 Tf 45 590 Td (Dark mode text and formula E = mc^2) Tj ET',
    '0.88 G 0.6 w 45 560 m 455 560 l S', '0.93 g 45 470 410 70 re f', 'BT /F1 13 Tf 0.35 g 55 500 Td (Pale callout box with grey text) Tj ET',
    'q 240 0 0 180 45 250 cm /Im1 Do Q', '1 0 0 rg 320 280 120 90 re f'].join('\n');
  const scanned = 'q 500 0 0 650 0 0 cm /Im2 Do Q';
  const pages = [];
  for (const drawing of [mixed, scanned]) {
    const content = add(`<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`);
    pages.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 650] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${photo} 0 R /Im2 ${scan} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
