// 深色主题下的 PDF：文字与线条用一条色调曲线反相（见 installDarkFilter），
// 彩色图片与照片不反相——从未经滤镜的画布上把这些区域原样复制到上面一层，只略微压暗。
// 扫描页、公式图片这类“白纸黑字”的灰度图片仍按文字处理，一起反相。

const FILTER_ID = 'kaizhi-pdf-dark';
// 页面底色约 #1d1d1e，正文约 #e3e3e3；指数小于 1，把原稿里接近白色的浅灰、细线和淡底色拉开，不再糊成一片。
// 反相再转 180° 色相会让颜色发灰，补一点饱和度，图表里的红绿蓝仍分得清。
export const DARK_TONE = { background: .115, foreground: .89, exponent: .68 };

/** One shared SVG filter: hue-preserving lightness inversion, then a tone curve into [background, foreground]. */
export function installDarkFilter(document = globalThis.document) {
  if (!document || document.getElementById(FILTER_ID)) return;
  const { background, foreground, exponent } = DARK_TONE;
  const channel = name => `<feFunc${name} type="gamma" amplitude="${foreground - background}" exponent="${exponent}" offset="${background}"/>`;
  const holder = document.createElement('div');
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><filter id="${FILTER_ID}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/><feColorMatrix type="hueRotate" values="180"/><feColorMatrix type="saturate" values="1.3"/><feComponentTransfer>${channel('R')}${channel('G')}${channel('B')}</feComponentTransfer></filter></svg>`;
  document.body.append(holder.firstElementChild);
}

// 照片层在深色主题下压暗到 86%；这个底色压暗后正好是深色纸面 #1d1d1e。
const PAPER_UNDER_DIM = '#222223';

const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Rectangles (viewport CSS pixels) where the page draws raster images, following the transform stack. */
export function imageRectangles(operatorList, viewportTransform, OPS) {
  const rectangles = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const unitSquare = matrix => {
    const device = multiply(viewportTransform, matrix);
    const points = [apply(device, 0, 0), apply(device, 1, 0), apply(device, 0, 1), apply(device, 1, 1)];
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const left = Math.min(...xs), top = Math.min(...ys);
    rectangles.push({ x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top });
  };
  const { fnArray, argsArray } = operatorList;
  for (let index = 0; index < fnArray.length; index++) {
    const fn = fnArray[index], args = argsArray[index];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiply(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    // 透明组只保存 / 恢复状态；组里的坐标变换由随后的 paintFormXObjectBegin 带来。
    else if (fn === OPS.beginGroup) stack.push(ctm);
    else if (fn === OPS.endGroup) ctm = stack.pop() || ctm;
    else if (fn === OPS.beginAnnotation) { stack.push(ctm); for (const matrix of [args?.[2], args?.[3]]) if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(ctm, matrix); }
    else if (fn === OPS.endAnnotation) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) unitSquare(ctm);
    else if (fn === OPS.paintImageXObjectRepeat) {
      const [, scaleX, scaleY, positions] = args || [];
      for (let at = 0; positions && at + 1 < positions.length; at += 2) unitSquare(multiply(ctm, [scaleX, 0, 0, scaleY, positions[at], positions[at + 1]]));
    }
  }
  return rectangles;
}

/**
 * Whether an image region reads like a document (scan, formula, line drawing on white paper):
 * mostly light pixels and almost no colour. Those are inverted with the text; everything else keeps its colours.
 */
export function looksLikePaper(pixels) {
  let light = 0, saturation = 0, count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
    const high = Math.max(red, green, blue), low = Math.min(red, green, blue);
    saturation += high ? (high - low) / high : 0;
    if (.2126 * red + .7152 * green + .0722 * blue > 190) light++;
    count++;
  }
  return !count || (saturation / count < .1 && light / count > .5);
}

/**
 * Builds the colour-preserving layer for one rendered page: small canvases copied from the page bitmap
 * over each colourful image. Returns null when the page has nothing to keep (text-only or scanned pages).
 */
export async function photoLayer(page, viewport, canvas, OPS) {
  const operators = await page.getOperatorList();
  const scaleX = canvas.width / viewport.width, scaleY = canvas.height / viewport.height;
  const pieces = [];
  const probe = document.createElement('canvas');
  probe.width = probe.height = 24;
  const sample = probe.getContext('2d', { willReadFrequently: true });
  for (const rectangle of imageRectangles(operators, viewport.transform, OPS)) {
    const x = Math.max(0, Math.floor(rectangle.x * scaleX)), y = Math.max(0, Math.floor(rectangle.y * scaleY));
    const width = Math.min(canvas.width, Math.ceil((rectangle.x + rectangle.width) * scaleX)) - x;
    const height = Math.min(canvas.height, Math.ceil((rectangle.y + rectangle.height) * scaleY)) - y;
    if (width < 8 || height < 8) continue;
    sample.clearRect(0, 0, 24, 24);
    sample.drawImage(canvas, x, y, width, height, 0, 0, 24, 24);
    if (looksLikePaper(sample.getImageData(0, 0, 24, 24).data)) continue;
    pieces.push({ x, y, width, height });
  }
  probe.width = probe.height = 0;
  if (!pieces.length) return null;
  const layer = document.createElement('div');
  layer.className = 'pdf-photos';
  layer.setAttribute('aria-hidden', 'true');
  for (const piece of pieces) {
    const copy = document.createElement('canvas');
    copy.width = piece.width; copy.height = piece.height;
    const paint = copy.getContext('2d');
    // 图片边缘的一两个像素混着白纸，不经滤镜会显出一圈亮边：先铺上与深色纸面一致的底色，再把内部原样画上去。
    paint.fillStyle = PAPER_UNDER_DIM;
    paint.fillRect(0, 0, piece.width, piece.height);
    const inset = Math.min(2, Math.floor(Math.min(piece.width, piece.height) / 8));
    paint.drawImage(canvas, piece.x + inset, piece.y + inset, piece.width - inset * 2, piece.height - inset * 2, inset, inset, piece.width - inset * 2, piece.height - inset * 2);
    Object.assign(copy.style, { left: `${piece.x / canvas.width * 100}%`, top: `${piece.y / canvas.height * 100}%`, width: `${piece.width / canvas.width * 100}%`, height: `${piece.height / canvas.height * 100}%` });
    layer.append(copy);
  }
  return layer;
}

export function releasePhotoLayer(layer) {
  if (!layer) return;
  for (const copy of layer.querySelectorAll('canvas')) copy.width = copy.height = 0;
  layer.remove();
}
