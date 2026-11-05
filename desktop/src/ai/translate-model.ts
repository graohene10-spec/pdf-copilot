/**
 * 翻译用的模型与思考强度：不再有「自动」，始终是一个具体的模型和强度。
 * 读者没选过（或选的模型已不在列表里）时，取该服务商的默认模型、该模型最低的思考强度，
 * 并原样显示出来，不交给服务端的默认配置（Codex 的默认往往是大模型 + 高强度，翻译很慢）。
 */
export type ModelEntry = { id: string; name?: string; efforts?: string[]; defaultEffort?: string }
const LOW = ['none', 'minimal', 'low']

export function lowestEffort(model: ModelEntry | undefined) {
  const efforts = (model?.efforts || []).filter(Boolean)
  return LOW.find(item => efforts.includes(item)) || efforts[0] || ''
}

/** 选定的模型（不在列表里就退回默认模型或列表第一个）与它支持的强度（不支持就取最低档）。 */
/** keepUnknown：API 服务商可以填列表里没有的新模型名，照原样保留；Codex 只认本机读到的列表。 */
export function concreteChoice(models: ModelEntry[], model: string, effort: string, defaultModel = '', keepUnknown = false): { model: string; effort: string } {
  const list = models.filter(item => item.id)
  if (!list.length || (keepUnknown && model && !list.some(item => item.id === model))) return { model, effort }
  const chosen = list.find(item => item.id === model) || list.find(item => item.id === defaultModel) || list[0]!
  const efforts = (chosen.efforts || []).filter(Boolean)
  return { model: chosen.id, effort: efforts.includes(effort) ? effort : lowestEffort(chosen) }
}
