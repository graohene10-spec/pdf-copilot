// Resize in memory; never persist a browser snapshot or use object/file URLs.
export async function compactPageImage(dataUrl, signal) {
  signal.throwIfAborted();
  const image = new Image(); image.src = dataUrl;
  await image.decode(); signal.throwIfAborted();
  const ratio = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  try {
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.85, .65, .45, .25]) {
      signal.throwIfAborted();
      const encoded = canvas.toDataURL('image/jpeg', quality);
      if (encoded.length <= 768000) return encoded;
    }
    throw new Error('当前页面图片过大，请手动框选需要解释的区域。');
  } finally { canvas.width = canvas.height = 0; image.removeAttribute('src'); }
}
