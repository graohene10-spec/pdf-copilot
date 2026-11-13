/**
 * 文档库的分组：像文件夹一样，一本书最多在一个分组里；分组可以先建好空着。记在文档库的设置里，随库保存。
 */
import { computed, ref } from 'vue'
import { library } from '../sdk'

export type Group = { id: string; name: string }
const KEY = 'library.groups.v1'
export const groups = ref<Group[]>([])
/** 文档编号 → 分组编号。 */
export const members = ref<Record<string, string>>({})
export const groupFilter = ref('')
export const currentGroup = computed(() => groups.value.find(group => group.id === groupFilter.value))

export async function loadGroups() {
  try {
    const value = JSON.parse(await library.getSetting(KEY) || '{}')
    groups.value = Array.isArray(value.groups) ? value.groups.filter((item: any) => item && typeof item.id === 'string' && typeof item.name === 'string') : []
    const known = new Set(groups.value.map(group => group.id))
    members.value = Object.fromEntries(Object.entries(value.members || {}).filter(([, group]) => typeof group === 'string' && known.has(group as string))) as Record<string, string>
  } catch { /* 没有记录就是还没分过组 */ }
}
function save() { return library.setSetting(KEY, JSON.stringify({ groups: groups.value, members: members.value })) }
const clean = (name: string) => name.trim().slice(0, 40)
export async function createGroup(name: string) {
  const value = clean(name)
  if (!value) return
  const existing = groups.value.find(group => group.name === value)
  if (existing) return existing
  const group = { id: crypto.randomUUID(), name: value }
  groups.value = [...groups.value, group]
  await save()
  return group
}
export async function renameGroup(id: string, name: string) {
  const value = clean(name)
  if (!value || groups.value.some(group => group.id !== id && group.name === value)) return
  groups.value = groups.value.map(group => group.id === id ? { ...group, name: value } : group)
  await save()
}
/** 删掉分组，里面的书回到「未分组」，书本身不动。 */
export async function removeGroup(id: string) {
  groups.value = groups.value.filter(group => group.id !== id)
  members.value = Object.fromEntries(Object.entries(members.value).filter(([, group]) => group !== id))
  if (groupFilter.value === id) groupFilter.value = ''
  await save()
}
/** 把几本书放进分组；group 留空是移出分组。 */
export async function assignGroup(ids: string[], group: string) {
  const next = { ...members.value }
  for (const id of ids) { if (group) next[id] = group; else delete next[id] }
  members.value = next
  await save()
}
