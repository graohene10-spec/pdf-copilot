import { library } from '../sdk'
import type { CustomFont } from '../settings'
import { describeFontFile } from './font-names'

export { describeFontFile }

// 用户自己导入的字体文件：字节存在本机文档库里（不随应用分发），启动时注册成网页字体。
const KEY = 'font.v1.'
const MAX_BYTES = 24 * 1024 * 1024
const registered = new Map<string, FontFace[]>()

function toBase64(bytes: Uint8Array) {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}
function fromBase64(text: string) { return Uint8Array.from(atob(text), char => char.charCodeAt(0)) }

/** Read font files, store their bytes locally and describe them for the preferences. */
export async function importFontFiles(files: File[]): Promise<CustomFont[]> {
  const fonts: CustomFont[] = []
  for (const file of files) {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error(`${file.name} 不是字体文件（支持 TTF、OTF、WOFF、WOFF2）。`)
    if (file.size > MAX_BYTES) throw new Error(`${file.name} 超过 24 MB。`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const font: CustomFont = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 24), ...describeFontFile(file.name) }
    // Check the browser can actually load it before keeping it.
    await new FontFace(font.family, bytes, { weight: font.weight, style: font.style }).load()
    await library.setSetting(KEY + font.id, toBase64(bytes))
    fonts.push(font)
  }
  return fonts
}
export async function forgetFontFile(id: string) {
  for (const face of registered.get(id) || []) document.fonts.delete(face)
  registered.delete(id)
  await library.setSetting(KEY + id, '').catch(() => {})
}

/** Register every imported font with the document; an Anthropic Serif file also answers to "Anthropic Serif". */
export async function registerCustomFonts(fonts: CustomFont[]) {
  for (const [id, faces] of registered) if (!fonts.some(font => font.id === id)) { for (const face of faces) document.fonts.delete(face); registered.delete(id) }
  await Promise.all(fonts.filter(font => !registered.has(font.id)).map(async font => {
    registered.set(font.id, [])
    try {
      const stored = await library.getSetting(KEY + font.id)
      if (!stored) return
      const bytes = fromBase64(stored)
      const names = new Set([font.family, ...(/anthropic\s*serif/i.test(font.family) ? ['Anthropic Serif'] : [])])
      const faces = [...names].map(name => new FontFace(name, bytes, { weight: font.weight, style: font.style }))
      await Promise.all(faces.map(face => face.load()))
      for (const face of faces) document.fonts.add(face)
      registered.set(font.id, faces)
    } catch { registered.delete(font.id) }
  }))
}
