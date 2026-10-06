// Synthetic PDFs only. No external files or personal document content.
export function samplePdf(count = 2, mixedSizes = false, navigation = false) {
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  add(''); add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = [];
  for (let page = 1; page <= count; page++) {
    const width = mixedSizes && page % 3 === 0 ? 650 : 500;
    const height = mixedSizes && page % 3 === 0 ? 500 : 650;
    const drawing = `BT /F1 22 Tf 45 ${height - 80} Td (Synthetic page ${page}) Tj ET\n1 0 0 rg 45 200 180 100 re f`;
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
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${outline} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count ${count} >>`;
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
