// 框选截图。原来松手时在主线程同步把选区编码成 PNG（大选区能卡住半秒以上），提问卡片要等它做完才弹出。
// 现在主线程只做一次 drawImage，PNG 编码交给浏览器后台线程（toBlob）；长边最多 1600 像素——
// 发给模型的图片本来就会被缩到这个量级，更大只是更慢。
import { canvasCrop, dataUrlBytes, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_LENGTH } from '../../../extension/reader/geometry.mjs'

export const MAX_CROP_EDGE = 1600
type Rect = { x: number; y: number; width: number; height: number }

/** Output size for a crop: never upscaled, long edge at most `MAX_CROP_EDGE`. */
export function cropSize(width: number, height: number, maxEdge = MAX_CROP_EDGE) {
  const ratio = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

function encode(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new Error('无法生成选区图片。')); return }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('无法生成选区图片。'))
    reader.readAsDataURL(blob)
  }, 'image/png'))
}

/** Copies the region synchronously (so a later repaint of `source` cannot change it), then encodes off the main thread. */
export async function cropImageAsync(source: HTMLCanvasElement, rect: Rect, displayWidth: number, displayHeight: number): Promise<string> {
  const crop = canvasCrop(rect, displayWidth, displayHeight, source.width, source.height)
  if (crop.width < 1 || crop.height < 1) throw new Error('请框选更大的区域。')
  const canvas = document.createElement('canvas')
  Object.assign(canvas, cropSize(crop.width, crop.height))
  const context = canvas.getContext('2d', { alpha: false })!
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
  try {
    let dataUrl = await encode(canvas)
    // 极少数特别复杂的区域超过上限时再逐步缩小。
    while ((dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) && canvas.width > 64 && canvas.height > 64) {
      const reduced = document.createElement('canvas')
      reduced.width = Math.max(1, Math.floor(canvas.width * .75)); reduced.height = Math.max(1, Math.floor(canvas.height * .75))
      reduced.getContext('2d')!.drawImage(canvas, 0, 0, reduced.width, reduced.height)
      canvas.width = reduced.width; canvas.height = reduced.height
      canvas.getContext('2d')!.drawImage(reduced, 0, 0)
      reduced.width = reduced.height = 0
      dataUrl = await encode(canvas)
    }
    if (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error('选区图片太大，请缩小范围后再试。')
    return dataUrl
  } finally { canvas.width = canvas.height = 0 }
}
