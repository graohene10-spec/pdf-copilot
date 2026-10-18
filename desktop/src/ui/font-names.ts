import type { CustomFont } from '../settings/model'

const WEIGHTS: [RegExp, string][] = [[/thin|hairline/i, '100'], [/extra-?light|ultra-?light/i, '200'], [/light/i, '300'], [/medium/i, '500'], [/semi-?bold|demi/i, '600'], [/extra-?bold|ultra-?bold/i, '800'], [/black|heavy/i, '900'], [/bold/i, '700']]

/** Guess family, weight and style from a font file name such as `AnthropicSerif-SemiboldItalic.woff2`. */
export function describeFontFile(name: string): Omit<CustomFont, 'id'> {
  const base = name.replace(/\.(ttf|otf|woff2?)$/i, '')
  const variable = /variable|\bvf\b|\[.*wght.*\]/i.test(base)
  const style = /italic|oblique/i.test(base) ? 'italic' : 'normal'
  const weight = variable ? '100 900' : WEIGHTS.find(([pattern]) => pattern.test(base))?.[1] || '400'
  let stem = base.replace(/\[.*?\]/g, '')
  // Strip trailing style words one at a time: "AnthropicSerif-Roman-Variable" → "AnthropicSerif".
  for (let previous = ''; previous !== stem;) { previous = stem; stem = stem.replace(/[-_ ]?(variable|vf|roman|regular|italic|oblique|thin|hairline|extra-?light|ultra-?light|light|book|medium|semi-?bold|demi-?bold|extra-?bold|ultra-?bold|bold|black|heavy)$/i, '') }
  const family = stem
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/['"\\;{}]/g, '')
    .trim() || 'Imported Font'
  return { family, file: name.slice(0, 200), weight, style }
}
