export interface BackgroundImage { name: string; dataUrl: string }

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_STORED_BYTES = 1024 * 1024
const MAX_EDGE = 2560
const MAX_PIXELS = 4_000_000
const MAX_SOURCE_EDGE = 16_000
const MAX_SOURCE_PIXELS = 40_000_000
const MAX_DATA_URL_LENGTH = 64 + Math.ceil(MAX_STORED_BYTES / 3) * 4
type ImageInfo = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }

function displayName(value: string): string {
  return (value.split(/[\\/]/).pop() || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim().slice(0, 120) || '自定义底板'
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

// Read dimensions before decoding so malformed or excessively large inputs never
// allocate an unbounded canvas. Browser decoding still validates the full image.
function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const length = bytes.length
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (length >= 33 && bytes[0] === 137 && ascii(bytes, 1, 7) === 'PNG\r\n\x1a\n' &&
      view.getUint32(8) === 13 && ascii(bytes, 12, 4) === 'IHDR') {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (length >= 12 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 3 < length) {
      if (bytes[offset++] !== 255) return null
      while (offset < length && bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) return null
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > length) return null
      const segment = view.getUint16(offset)
      if (segment < 2 || offset + segment > length) return null
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (segment < 8) return null
        return { mime: 'image/jpeg', height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) }
      }
      offset += segment
    }
  }
  if (length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' &&
      view.getUint32(4, true) + 8 === length) {
    let offset = 12
    while (offset + 8 <= length) {
      const kind = ascii(bytes, offset, 4)
      const size = view.getUint32(offset + 4, true)
      const data = offset + 8
      if (data + size > length) return null
      if (kind === 'VP8X' && size >= 10) {
        return { mime: 'image/webp', width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16),
          height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16) }
      }
      if (kind === 'VP8 ' && size >= 10 && ascii(bytes, data + 3, 3) === '\x9d\x01\x2a') {
        return { mime: 'image/webp', width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff }
      }
      if (kind === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
        const bits = view.getUint32(data + 1, true)
        return { mime: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
      }
      offset = data + size + (size & 1)
    }
  }
  return null
}

function validDimensions(info: ImageInfo, edge: number, pixels: number): boolean {
  return info.width > 0 && info.height > 0 && info.width <= edge && info.height <= edge && info.width * info.height <= pixels
}

let cachedDataUrl: string | undefined
let cachedDataUrlValid = false
function validDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length > MAX_DATA_URL_LENGTH) return false
  if (value === cachedDataUrl) return cachedDataUrlValid
  let valid = false
  if (value.length <= MAX_DATA_URL_LENGTH) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    if (match && match[2].length % 4 === 0) {
      try {
        const binary = atob(match[2])
        if (binary.length <= MAX_STORED_BYTES) {
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
          const info = imageInfo(bytes)
          valid = !!info && info.mime === match[1] && validDimensions(info, MAX_EDGE, MAX_PIXELS)
        }
      } catch { /* Invalid base64 falls back to the built-in background. */ }
    }
  }
  cachedDataUrl = value
  cachedDataUrlValid = valid
  return valid
}

export function normalizeBackground(value: unknown): BackgroundImage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.name !== 'string' || input.name.length > 4096 || !validDataUrl(input.dataUrl)) return null
  return { name: displayName(input.name), dataUrl: input.dataUrl }
}

export function backgroundErrors(value: unknown): string[] {
  if (value === null || value === undefined) return []
  return normalizeBackground(value) ? [] : ['底板图片无效，请重新选择 PNG、JPEG 或 WebP 图片。']
}

async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* Fall back for image formats not handled by createImageBitmap. */ }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight,
      release: () => { image.src = ''; URL.revokeObjectURL(url) } }
  } catch {
    image.src = ''
    URL.revokeObjectURL(url)
    throw new Error('图片无法读取，请选择完整的 PNG、JPEG 或 WebP 图片。')
  }
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('图片处理失败，请换一张图片后重试。')); return }
      if (blob.type === 'image/webp') { resolve(blob); return }
      canvas.toBlob(jpeg => jpeg ? resolve(jpeg) : reject(new Error('图片处理失败，请换一张图片后重试。')), 'image/jpeg', quality)
    }, 'image/webp', quality)
  })
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:${blob.type};base64,${btoa(binary)}`
}

export async function importBackgroundImage(file: File): Promise<BackgroundImage> {
  if (!file || file.size === 0) throw new Error('请选择有效的图片文件。')
  if (file.size > MAX_FILE_BYTES) throw new Error('图片超过 20 MB，请先缩小图片后再选择。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const info = imageInfo(bytes)
  if (!info) throw new Error('暂时支持 PNG、JPEG 和 WebP 图片，请换一种格式。')
  if (!validDimensions(info, MAX_SOURCE_EDGE, MAX_SOURCE_PIXELS)) throw new Error('图片尺寸过大，请缩小到 4000 万像素以内，且边长不超过 16000 像素。')
  // Re-encoding removes metadata and only persists raster pixels from a local
  // file. Neither uploaded content nor stored backgrounds can point to a URL.
  const image = await decodeImage(new Blob([bytes], { type: info.mime }))
  const canvas = document.createElement('canvas')
  try {
    if (!image.width || !image.height || image.width > MAX_SOURCE_EDGE || image.height > MAX_SOURCE_EDGE || image.width * image.height > MAX_SOURCE_PIXELS) throw new Error('图片尺寸无效，请换一张图片。')
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height), Math.sqrt(MAX_PIXELS / (image.width * image.height)))
    let width = Math.max(1, Math.floor(image.width * scale))
    let height = Math.max(1, Math.floor(image.height * scale))
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('当前环境无法处理图片，请重新启动软件后重试。')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      context.drawImage(image.source, 0, 0, width, height)
      const blob = await encodeCanvas(canvas, Math.max(.7, .86 - attempt * .03))
      if (blob.size <= MAX_STORED_BYTES) {
        const background = normalizeBackground({ name: displayName(file.name), dataUrl: await blobDataUrl(blob) })
        if (background) return background
        throw new Error('处理后的图片无法保存，请换一张图片。')
      }
      width = Math.max(1, Math.floor(width * .8))
      height = Math.max(1, Math.floor(height * .8))
    }
    throw new Error('图片内容过于复杂，请先缩小图片后再选择。')
  } finally {
    image.release()
    canvas.width = 0
    canvas.height = 0
  }
}
