<script setup lang="ts">
// 总结开始前的那张表：一张实心的卡片，像一份表单。要素有七八项，全摊开会是一片按钮，所以平时每项只占一行：
// 左边名字，右边现在的值（没填是淡淡的「不指定」）。点哪一行哪一行展开，各开各的——开一行不会把别的行收起来，
// 所以点下去的那一行不会在手底下挪位置。别的要求读者直接写在下面的输入框里，和这张表一起发出去。
// 同一张表也用来改已经发出去的那一问（editing）：这时多一行「其他要求」，按钮换成「重新总结」。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { offerSpaced } from '../ui/hints'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'
import { radioKeys } from '../ui/radio-keys'
import { SUMMARY_FIELDS, UI_AMOUNTS, UI_LEANS, COMPLETE, summaryChapters, chapterGroups, chapterScope, chapterLabel, chosenFromScope, type Chapter, type SummaryOptions } from '../ai/summary'

type Field = typeof SUMMARY_FIELDS[number]
type Group = { at: number; parts: number[] }
const props = defineProps<{ title: string; options: SummaryOptions; hasSelection?: boolean; /** 这份文档的目录：范围那一行里列出来让读者勾。没有目录就是空的。 */ outline?: Chapter[]
  /** 在改已经发出去的那张表。 */ editing?: boolean; /** 改的时候：表格之外另写的要求。 */ extra?: string }>()
const emit = defineEmits<{ start: []; cancel: []; 'update:extra': [value: string] }>()
// 表格直接改这段对话自己的设置（options 是对话状态里的那个对象；改的时候是它的一份副本）。
const options = props.options
onMounted(() => { if (!props.editing) offerSpaced('summary-setup', ['都可以不填'], '别的要求写进输入框，按发送开始') })
const open = reactive(new Set<string>(props.editing ? [] : ['scope']))
function toggleRow(key: string) { if (open.has(key)) open.delete(key); else open.add(key) }
// 指着哪个选项：这一行下面立刻显示它是什么意思，方便一个个比着看。
const hover = ref('')
/** 展开的那一行下面的一句说明：指着的选项优先，其次是已经选中的那一个（只选了一个时），都没有就是这一项的提示。 */
function noteOf(field: Field) {
  if (hover.value && field.notes[hover.value]) return `${hover.value}：${field.notes[hover.value]}`
  const list = own(field) || (field.key === 'scope' && chosen.size) ? [] : picked(field)
  if (list.length === 1 && field.notes[list[0]!]) return `${list[0]}：${field.notes[list[0]!]}`
  return field.hint
}
const SLIDER = { selector: "[aria-checked='true']", radius: '8px' }
const choices = (field: Field) => field.key === 'scope' && props.hasSelection ? [...field.options, '选中的内容'] : field.options
const picked = (field: Field) => options[field.key] ? options[field.key].split('、').filter(Boolean) : []
// 范围：把文档的目录列成「章 → 节」。勾一章＝整章（它的节跟着全勾上）；展开后可以只勾几节，这时章的方框是一道横杠。
const chapters = computed(() => summaryChapters(props.outline))
const groups = computed(() => chapterGroups(chapters.value))
const chosen = reactive(new Set<number>())
const unfolded = reactive(new Set<number>())
// 改表时：把那句范围读回成勾选；只勾了几节的章先展开着。
watch(chapters, list => {
  if (chosen.size || !list.length) return
  for (const index of chosenFromScope(list, options.scope) || []) chosen.add(index)
  for (const group of groups.value) if (!chosen.has(group.at) && group.parts.some(index => chosen.has(index))) unfolded.add(group.at)
}, { immediate: true })
const stateOf = (group: Group) => chosen.has(group.at) ? 'true' : group.parts.some(index => chosen.has(index)) ? 'mixed' : 'false'
const commit = () => { options.scope = chapterScope(chapters.value, chosen) }
function toggleGroup(group: Group) {
  const whole = chosen.has(group.at)
  for (const index of [group.at, ...group.parts]) if (whole) chosen.delete(index); else chosen.add(index)
  commit()
}
function togglePart(group: Group, index: number) {
  if (chosen.has(index)) chosen.delete(index); else chosen.add(index)
  if (group.parts.every(part => chosen.has(part))) chosen.add(group.at); else chosen.delete(group.at)
  commit()
}
function toggleFold(at: number) { if (unfolded.has(at)) unfolded.delete(at); else unfolded.add(at) }
// 键盘：整棵目录只占一个 Tab 位；↑↓ 换一行，→ 展开（再按进到第一节），← 收起（在节上是回到它的章），空格勾选。
const cursor = ref(-1)
const shownRow = (index: number) => groups.value.some(group => group.at === index || unfolded.has(group.at) && group.parts.includes(index))
function tabOf(index: number) {
  const at = cursor.value >= 0 && shownRow(cursor.value) ? cursor.value : cursor.value >= 0 ? groups.value.find(group => group.parts.includes(cursor.value))?.at : groups.value[0]?.at
  return at === index ? 0 : -1
}
function treeKey(event: KeyboardEvent) {
  const el = (event.target as HTMLElement).closest<HTMLElement>('.sum-chapter')
  if (!el || event.altKey || event.ctrlKey || event.metaKey) return
  const list = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.sum-chapter')], at = list.indexOf(el), index = Number(el.dataset.index)
  const group = groups.value.find(item => item.at === index), parent = group ? undefined : groups.value.find(item => item.parts.includes(index))
  let next: HTMLElement | undefined
  if (event.key === 'ArrowDown') next = list[at + 1]
  else if (event.key === 'ArrowUp') next = list[at - 1]
  else if (event.key === 'Home') next = list[0]
  else if (event.key === 'End') next = list.at(-1)
  else if (event.key === 'ArrowRight') { if (group?.parts.length) { if (unfolded.has(index)) next = list[at + 1]; else unfolded.add(index) } }
  else if (event.key === 'ArrowLeft') { if (group && unfolded.has(index)) unfolded.delete(index); else if (parent) next = list.find(item => Number(item.dataset.index) === parent.at) }
  else return
  event.preventDefault()
  next?.focus()
}
const pagesOf = (chapter: Chapter) => chapter.page ? chapter.end && chapter.end > chapter.page ? `${chapter.page}–${chapter.end}` : String(chapter.page) : ''
/** 这一项的值是读者自己写的（不在现成的选项里，也不是勾出来的章节）。 */
const own = (field: Field) => !(field.key === 'scope' && chosen.size) && picked(field).some(item => !choices(field).includes(item))
/** 行尾显示的值：勾了章节就说勾了什么，不把一长串章名挤在一行里。 */
const shown = (field: Field) => field.key === 'scope' && chosen.size ? chapterLabel(chapters.value, chosen) : options[field.key]
function write(field: Field, value: string) { if (field.key === 'scope') chosen.clear(); options[field.key] = value }
function pick(field: Field, option: string) {
  if (field.key === 'scope') chosen.clear()
  const list = own(field) ? [] : picked(field)
  if (!field.many) { options[field.key] = list[0] === option ? '' : option; return }
  const at = list.indexOf(option)
  if (at >= 0) list.splice(at, 1); else list.push(option)
  options[field.key] = list.join('、')
}
const on = (field: Field, option: string) => !own(field) && !(field.key === 'scope' && chosen.size) && (field.many ? picked(field).includes(option) : options[field.key] === option)
// 不遗漏知识点：写出来很长，一次回复装不下，所以总是分多次写。
const rounds = computed(() => options.multi || options.complete)
function toggleMulti() { if (!options.complete) options.multi = !options.multi }
</script>

<template>
  <section class="sum-card" :class="{ editing }" :aria-label="editing ? '修改总结设置' : '总结设置'">
    <header class="sum-head"><h3>总结</h3><p :title="title">{{ title }}</p></header>
    <div class="sum-list">
      <div v-for="field in SUMMARY_FIELDS" :key="field.key" class="sum-row" :class="{ open: open.has(field.key) }">
        <button type="button" class="sum-line" :aria-expanded="open.has(field.key)" @click="toggleRow(field.key)">
          <span class="sum-label">{{ field.label }}</span>
          <span class="sum-value" :class="{ none: !shown(field) }">{{ shown(field) || '不指定' }}</span>
          <AppIcon name="arrow" :size="11" class="sum-caret" />
        </button>
        <!-- 这一行的选项一直在，收起时高度是零：开、合都是一段平滑的伸缩，不是一下子冒出来。 -->
        <div class="sum-fold" :inert="!open.has(field.key) || undefined"><div class="sum-options">
          <button v-for="option in choices(field)" :key="option" type="button" class="sum-chip" :aria-pressed="on(field, option)" @click="pick(field, option)" @pointerenter="hover = option" @pointerleave="hover = ''" @focus="hover = option" @blur="hover = ''">{{ option }}</button>
          <p class="sum-explain" :class="{ short: field.key === 'scope' }" aria-live="polite">{{ noteOf(field) }}</p>
          <!-- 范围：这份文档的章，每章前面一个小箭头，展开是它的节。 -->
          <div v-if="field.key === 'scope' && chapters.length" class="sum-chapters" role="group" aria-label="按章节选" @keydown="treeKey">
            <template v-for="group in groups" :key="group.at">
              <div class="sum-chapter-row">
                <button v-if="group.parts.length" type="button" class="sum-unfold" tabindex="-1" :aria-expanded="unfolded.has(group.at)" :aria-label="`${unfolded.has(group.at) ? '收起' : '展开'}「${chapters[group.at]!.title}」的小节`" @click="toggleFold(group.at)"><AppIcon name="arrow" :size="10" /></button>
                <span v-else class="sum-unfold" aria-hidden="true"></span>
                <button type="button" class="sum-chapter" role="checkbox" :aria-checked="stateOf(group)" :aria-expanded="group.parts.length ? unfolded.has(group.at) : undefined" :data-index="group.at" :tabindex="tabOf(group.at)" @focus="cursor = group.at" @click="toggleGroup(group)"><i aria-hidden="true"></i><span>{{ chapters[group.at]!.title }}</span><small v-if="pagesOf(chapters[group.at]!)">{{ pagesOf(chapters[group.at]!) }}</small></button>
              </div>
              <template v-if="unfolded.has(group.at)">
                <button v-for="index in group.parts" :key="index" type="button" class="sum-chapter sub" role="checkbox" :aria-checked="chosen.has(index)" :data-index="index" :tabindex="tabOf(index)" @focus="cursor = index" @click="togglePart(group, index)"><i aria-hidden="true"></i><span>{{ chapters[index]!.title }}</span><small v-if="pagesOf(chapters[index]!)">{{ pagesOf(chapters[index]!) }}</small></button>
              </template>
            </template>
          </div>
          <p v-else-if="field.key === 'scope'" class="sum-nochapters">这份文档没有目录。</p>
          <input :value="own(field) ? options[field.key] : ''" type="text" maxlength="200" :placeholder="field.placeholder" :aria-label="`${field.label}：自己写`" @input="write(field, ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="!$event.isComposing && $event.keyCode !== 229 && emit('start')" />
        </div></div>
      </div>
      <!-- 三个开关。图解与可交互打开后，下面多出两行：放多少、偏向哪一类。 -->
      <div class="sum-row">
        <button type="button" class="sum-line" role="switch" :aria-checked="options.complete" data-tip="一节一节写，定义、定理、公式、结论、例题每一条都写到；篇幅会长很多，用量也多" @click="options.complete = !options.complete">
          <span class="sum-label wide">{{ COMPLETE }}</span><i class="sum-switch" aria-hidden="true"></i>
        </button>
      </div>
      <div class="sum-row">
        <button type="button" class="sum-line" role="switch" :aria-checked="options.ui" data-tip="在文档里用 Intelligent UI：图解，和可以拖动、筛选的演示" @click="options.ui = !options.ui">
          <span class="sum-label wide">图解与可交互</span><i class="sum-switch" aria-hidden="true"></i>
        </button>
        <div v-if="options.ui" class="sum-sub">
          <!-- 三选一做成一条滑轨：选中的那一格下面有一块滑块，换一格它滑过去（玻璃风格下是一滴玻璃）。 -->
          <div class="sum-seg"><span>数量</span><div v-liquid-selection="SLIDER" class="sum-track" role="radiogroup" aria-label="放多少" @keydown="radioKeys"><button v-for="item in UI_AMOUNTS" :key="item.id" type="button" role="radio" :aria-checked="options.uiAmount === item.id" :tabindex="options.uiAmount === item.id ? 0 : -1" @click="options.uiAmount = item.id">{{ item.label }}</button></div></div>
          <div class="sum-seg"><span>偏向</span><div v-liquid-selection="SLIDER" class="sum-track" role="radiogroup" aria-label="偏向哪一类" @keydown="radioKeys"><button v-for="item in UI_LEANS" :key="item.id" type="button" role="radio" :aria-checked="options.uiLean === item.id" :tabindex="options.uiLean === item.id ? 0 : -1" @click="options.uiLean = item.id">{{ item.label }}</button></div></div>
        </div>
      </div>
      <div class="sum-row">
        <button type="button" class="sum-line" role="switch" :aria-checked="rounds" :aria-disabled="options.complete || undefined" :data-tip="options.complete ? '不遗漏知识点时总是分多次写' : '文档很长时用：助手一段一段地读、一段一段地写，自己接着写到完，用量更多。不开就是一次写完'" @click="toggleMulti">
          <span class="sum-label wide">分多次写</span><i class="sum-switch" aria-hidden="true"></i>
        </button>
      </div>
      <label v-if="editing" class="sum-row sum-extra"><span class="sum-label wide">其他要求</span><textarea :value="extra" rows="2" maxlength="2000" placeholder="表里没有的，写在这里" @input="emit('update:extra', ($event.target as HTMLTextAreaElement).value)"></textarea></label>
    </div>
    <footer class="sum-foot"><button type="button" class="sum-cancel" @click="emit('cancel')">{{ editing ? '取消' : '不总结了' }}</button><button type="button" class="sum-start" @click="emit('start')">{{ editing ? '重新总结' : '开始总结' }}</button></footer>
  </section>
</template>

<style scoped>
/* 一张实心的表单卡片：字用正经的界面字体，底是不透明的，后面的横线、纹理不穿过字。 */
.sum-card{position:relative;display:flex;flex-direction:column;max-width:520px;margin:2vh auto 10px;padding:16px 18px 14px;border:1px solid var(--hairline);border-radius:14px;background:var(--surface,var(--canvas));box-shadow:0 1px 2px rgb(0 0 0 / .04),0 10px 26px -18px rgb(0 0 0 / .28);color:var(--ink);font-size:13.5px;line-height:1.5;text-align:left;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
.sum-card{box-sizing:border-box}
.sum-card.editing{width:100%;max-width:none;margin:12px 0 8px}
.sum-head{display:flex;flex-direction:column;gap:2px;min-width:0;padding-bottom:12px}
.sum-head h3{margin:0;font-size:17px;font-weight:650;letter-spacing:.02em}
.sum-head p{min-width:0;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:12.5px}
/* 一行一项，行与行之间一道细线。 */
.sum-list{border-top:1px solid var(--hairline)}
.sum-row{border-bottom:1px solid var(--hairline)}
.sum-line{display:flex;align-items:center;gap:12px;width:100%;min-height:40px;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.sum-label{flex:none;width:3.2em;font-size:13.5px;font-weight:550;white-space:nowrap}
.sum-label.wide{flex:1;width:auto}
.sum-value{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--secondary);font-size:13px;text-align:right}
.sum-value.none{color:var(--muted)}
.sum-caret{flex:none;color:var(--muted);rotate:180deg;transition:rotate var(--dur-2) var(--spring-snappy)}
.sum-row.open .sum-caret{rotate:-90deg}
/* 收起是零高，展开是内容的高：行与行之间互不牵连。里面留一点边，按钮的焦点框不被裁掉。 */
.sum-fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows var(--dur-3,.26s) var(--ease-out)}
.sum-row.open>.sum-fold{grid-template-rows:1fr}
.sum-options{display:flex;flex-wrap:wrap;gap:6px;min-height:0;margin:0 -4px;padding:0 4px;overflow:hidden;opacity:0;transition:opacity var(--dur-2) var(--ease-out),padding var(--dur-3,.26s) var(--ease-out)}
.sum-row.open .sum-options{padding:2px 4px 13px;opacity:1}
.sum-chip{height:28px;padding:0 12px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:13px;white-space:nowrap;transition:background var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft)}
/* 选项下面的一句说明：指着哪个说哪个。占固定的两行高，换来换去下面的东西不跳。 */
.sum-explain{flex:1 1 100%;min-height:3.1em;margin:1px 0 0;color:var(--secondary);font-size:12.5px;line-height:1.55}
.sum-explain.short{min-height:0}
.sum-chip:hover{border-color:color-mix(in srgb,var(--ink) 40%,transparent);color:var(--ink)}
.sum-chip[aria-pressed='true']{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);font-weight:600}
/* 章节：一个不高的小列表，自己滚。章一行：小箭头、方框、章名、页码；展开后它的节缩进排在下面。 */
.sum-chapters{flex:1 1 100%;display:flex;flex-direction:column;max-height:232px;padding:4px;overflow:auto;border:1px solid var(--hairline);border-radius:8px}
.sum-chapter-row{display:flex;align-items:center;flex:none}
.sum-unfold{display:grid;place-items:center;flex:none;width:22px;height:30px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--muted)}
button.sum-unfold:hover{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.sum-unfold svg{rotate:180deg;transition:rotate var(--dur-2) var(--spring-snappy)}
.sum-unfold[aria-expanded='true'] svg{rotate:-90deg}
.sum-chapter{display:flex;align-items:center;gap:9px;flex:1;min-width:0;min-height:30px;padding:0 6px 0 4px;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left}
.sum-chapter.sub{flex:none;width:calc(100% - 40px);margin-left:40px;color:var(--secondary);animation:sum-part var(--dur-2) var(--ease-out) both}
@keyframes sum-part{from{opacity:0;translate:0 -3px}}
.sum-chapter:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.sum-chapter i{position:relative;flex:none;width:13px;height:13px;border:1.5px solid color-mix(in srgb,var(--ink) 42%,transparent);border-radius:3px;transition:background var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft)}
.sum-chapter span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sum-chapter small{flex:none;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.sum-chapter[aria-checked='true']{font-weight:600}
.sum-chapter[aria-checked='true'] i{border-color:var(--accent);background:var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2.6 6.2 2.3 2.3 4.6-5' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/11px no-repeat}
/* 只勾了其中几节：方框里一道横杠。 */
.sum-chapter[aria-checked='mixed'] i{border-color:var(--accent)}
.sum-chapter[aria-checked='mixed'] i::after{content:'';position:absolute;left:2px;right:2px;top:calc(50% - 1px);height:2px;border-radius:1px;background:var(--accent)}
.sum-nochapters{flex:1 1 100%;margin:0;color:var(--muted);font-size:12.5px}
.sum-options input,.sum-extra textarea{flex:1 1 100%;min-width:0;height:32px;padding:0 10px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;outline:0}
.sum-options input:focus,.sum-extra textarea:focus{border-color:var(--accent)}
.sum-options input::placeholder,.sum-extra textarea::placeholder{color:var(--muted)}
.sum-extra{display:flex;flex-direction:column;gap:2px;padding:9px 0 12px}
.sum-extra textarea{flex:none;height:auto;min-height:54px;padding:7px 10px;line-height:1.5;resize:vertical}
/* 开关：一个小滑块。 */
.sum-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:color-mix(in srgb,var(--ink) 20%,transparent);transition:background var(--dur-2) var(--ease-soft)}
.sum-switch::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .25);transition:translate var(--dur-2) var(--spring-snappy)}
.sum-line[aria-checked='true'] .sum-switch{background:var(--accent)}
.sum-line[aria-checked='true'] .sum-switch::after{translate:14px 0}
.sum-line[aria-disabled='true']{cursor:default}
.sum-line[aria-disabled='true'] :is(.sum-label,.sum-switch){opacity:.55}
/* 打开「图解与可交互」后多出来的两行：各是一条三选一。 */
.sum-sub{display:flex;flex-direction:column;gap:8px;padding:0 0 13px;animation:sum-open var(--dur-2) var(--ease-out) both}
@keyframes sum-open{from{opacity:0;translate:0 -4px}}
.sum-seg{display:flex;align-items:center;gap:0}
.sum-seg>span{flex:none;width:3.2em;color:var(--secondary);font-size:13px;white-space:nowrap}
/* 滑轨：一条浅槽，里面三格；滑块是指示器（liquid-selection 放进来的那个元素）。 */
.sum-track{position:relative;display:flex;flex:1;min-width:0;padding:3px;border-radius:11px;background:color-mix(in srgb,var(--ink) 8%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / .06)}
.sum-track button{position:relative;z-index:1;flex:1;min-width:0;height:26px;padding:0 6px;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:13px;white-space:nowrap;transition:color var(--dur-1) var(--ease-soft)}
.sum-track button:hover{color:var(--ink)}
.sum-track button[aria-checked='true']{color:var(--ink);font-weight:600}
.sum-track :deep(.liquid-indicator){border:0;background-color:var(--surface,#fff);background-image:none;box-shadow:0 1px 3px rgb(0 0 0 / .2),0 0 0 .5px rgb(0 0 0 / .06);filter:none}
/* 玻璃风格：滑块是一滴玻璃，带高光和一圈亮边。 */
:root[data-style='glass'] .sum-track{background:color-mix(in srgb,var(--ink) 7%,transparent)}
:root[data-style='glass'] .sum-track :deep(.liquid-indicator){background-color:var(--control-selected);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow),inset 0 1px 0 var(--glass-rim,rgb(255 255 255 / .6)),inset 0 0 0 .5px var(--glass-rim-soft,rgb(255 255 255 / .3));-webkit-backdrop-filter:blur(6px) saturate(1.4);backdrop-filter:blur(6px) saturate(1.4)}
.sum-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px}
.sum-cancel{height:32px;padding:0 2px;border:0;background:none;box-shadow:none;color:var(--muted);font:inherit;font-size:13px}
.sum-cancel:hover{color:var(--ink)}
.sum-start{height:34px;padding:0 20px;border:0;border-radius:9px;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff);font:inherit;font-size:13.5px;font-weight:600;transition:filter var(--dur-1) var(--ease-soft),scale var(--dur-2) var(--spring-snappy)}
.sum-start:hover{filter:brightness(1.06)}
.sum-start:active{scale:.97}
@media (prefers-reduced-motion:reduce){.sum-card,.sum-sub,.sum-chapter.sub{animation:none}.sum-fold,.sum-options{transition:none}}

/* 草稿风格：一张用胶带贴着的表。框、方框、开关、选中的记号都是铅笔画的，名字和按钮是手写的；
   要读的东西（文档名、填的值、章名、说明）用正经字体，一眼看得清。字都摆正，歪的只有胶带。 */
:root[data-style='sketch'] .sum-card{--hatch:repeating-linear-gradient(-35deg,color-mix(in srgb,var(--pencil) 17%,transparent) 0 1.3px,transparent 1.3px 6px);padding:20px 20px 14px;border:1.5px solid var(--pencil);border-radius:var(--r-bar);background:var(--paper);box-shadow:3px 4px 0 color-mix(in srgb,var(--pencil) 16%,transparent);font-family:var(--font-formal)}
:root[data-style='sketch'] .sum-card::before{content:'';position:absolute;top:-10px;left:calc(50% - 44px);width:88px;height:20px;background:var(--tape);box-shadow:0 1px 2px rgb(60 50 30 / .16);rotate:-2.5deg;pointer-events:none}
:root[data-style='sketch'] .sum-head h3{font-family:var(--font-display);font-size:27px;line-height:1.15;letter-spacing:.06em;text-decoration:underline wavy var(--red-pencil) 1.2px;text-underline-offset:6px}
:root[data-style='sketch'] .sum-head{gap:9px}
:root[data-style='sketch'] .sum-list{border-top:1.5px solid var(--pencil)}
:root[data-style='sketch'] .sum-row{border-bottom:1.2px dashed color-mix(in srgb,var(--pencil) 34%,transparent)}
:root[data-style='sketch'] .sum-row:last-child{border-bottom:0}
:root[data-style='sketch'] .sum-line,:root[data-style='sketch'] .sum-chapter,:root[data-style='sketch'] .sum-unfold,:root[data-style='sketch'] .sum-cancel{border-radius:0}
:root[data-style='sketch'] .sum-line:hover:not(:disabled),:root[data-style='sketch'] .sum-chapter:hover:not(:disabled),:root[data-style='sketch'] .sum-unfold:hover:not(:disabled){rotate:none}
:root[data-style='sketch'] .sum-label,:root[data-style='sketch'] .sum-seg>span{font-family:var(--font);font-size:18px;font-weight:400;letter-spacing:.03em}
:root[data-style='sketch'] .sum-chip{height:30px;padding:0 13px;border:1.4px solid var(--pencil);border-radius:var(--r-control);font-family:var(--font);font-size:16.5px;color:var(--ink)}
:root[data-style='sketch'] .sum-chip[aria-pressed='true']{border-color:var(--pencil);background:var(--hatch);box-shadow:1.5px 2px 0 color-mix(in srgb,var(--pencil) 20%,transparent);font-weight:400}
:root[data-style='sketch'] .sum-chapters{border:1.4px solid color-mix(in srgb,var(--pencil) 55%,transparent);border-radius:10px 14px 11px 13px / 13px 10px 14px 11px}
:root[data-style='sketch'] .sum-chapter{font-family:var(--font-formal)}
:root[data-style='sketch'] .sum-chapter:hover,:root[data-style='sketch'] button.sum-unfold:hover{background:color-mix(in srgb,var(--pencil) 7%,transparent)}
/* 方框是手画的，勾是红铅笔打的，画出框外一点。 */
:root[data-style='sketch'] .sum-chapter i{width:14px;height:14px;border:1.5px solid var(--pencil);border-radius:3px 5px 4px 6px / 5px 3px 6px 4px;background:none}
:root[data-style='sketch'] .sum-chapter[aria-checked='true'] i{border-color:var(--pencil);background:none}
:root[data-style='sketch'] .sum-chapter[aria-checked='true'] i::after{content:'';position:absolute;left:-1px;top:-7px;width:20px;height:19px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 19'%3E%3Cpath d='M3.2 10.6c1.6 1.5 2.7 3 3.6 4.9C9.4 9.6 12.7 5.6 17.6 2.2' fill='none' stroke='%23c8553d' stroke-width='2.1' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat}
:root[data-style='sketch'] .sum-chapter[aria-checked='mixed'] i{border-color:var(--pencil)}
:root[data-style='sketch'] .sum-chapter[aria-checked='mixed'] i::after{left:1.5px;right:1.5px;background:var(--red-pencil)}
/* 自己写的那一格：写在一条横线上。 */
:root[data-style='sketch'] .sum-options input{padding:0 2px;border:0;border-bottom:1.4px solid color-mix(in srgb,var(--pencil) 50%,transparent);border-radius:0;font-size:16px}
:root[data-style='sketch'] .sum-options input:focus{border-bottom-color:var(--pencil)}
:root[data-style='sketch'] .sum-extra textarea{border:1.4px solid color-mix(in srgb,var(--pencil) 55%,transparent);border-radius:10px 14px 11px 13px / 13px 10px 14px 11px;font-size:16px}
/* 开关：铅笔画的一条槽，里面一颗涂黑的圆点。 */
:root[data-style='sketch'] .sum-switch{width:36px;height:20px;border:1.5px solid var(--pencil);border-radius:11px 13px 12px 14px / 13px 11px 14px 12px;background:none}
:root[data-style='sketch'] .sum-switch::after{left:2px;top:2px;width:13px;height:13px;border:1.5px solid var(--pencil);background:var(--paper);box-shadow:none;box-sizing:border-box}
:root[data-style='sketch'] .sum-line[aria-checked='true'] .sum-switch{background:var(--hatch)}
:root[data-style='sketch'] .sum-line[aria-checked='true'] .sum-switch::after{translate:16px 0;background:var(--pencil)}
/* 滑轨：铅笔框，滑块是主题里那块排线。 */
:root[data-style='sketch'] .sum-track{border:1.4px solid var(--pencil);border-radius:var(--r-control);background:none;box-shadow:none}
:root[data-style='sketch'] .sum-track button{font-family:var(--font);font-size:16.5px;font-weight:400}
:root[data-style='sketch'] .sum-track :deep(.liquid-indicator){border:1.4px solid var(--pencil);background-color:transparent;background-image:var(--hatch);box-shadow:1.5px 2px 0 color-mix(in srgb,var(--pencil) 18%,transparent)}
:root[data-style='sketch'] .sum-start{height:36px;padding:0 22px;border:1.5px solid var(--pencil);border-radius:var(--r-control);background:var(--pencil);box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil) 26%,transparent);color:var(--paper);font-family:var(--font);font-size:18px;font-weight:400;letter-spacing:.06em}
:root[data-style='sketch'] .sum-cancel{font-family:var(--font);font-size:17px}
</style>
