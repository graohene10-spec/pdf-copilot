<script setup lang="ts">
// 总结开始前的那张表：一张实心的卡片，像一份表单。要素有七八项，全摊开会是一片按钮，所以平时每项只占一行：
// 左边名字，右边现在的值（没填是淡淡的「不指定」）。点哪一行哪一行展开，一次只开一行。范围最说不清，默认先开着它。
// 别的要求读者直接写在下面的输入框里，和这张表一起发出去。
import { computed, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'
import { radioKeys } from '../ui/radio-keys'
import { SUMMARY_FIELDS, UI_AMOUNTS, UI_LEANS, summaryChapters, chapterScope, type Chapter, type SummaryOptions } from '../ai/summary'

type Field = typeof SUMMARY_FIELDS[number]
const props = defineProps<{ title: string; options: SummaryOptions; hasSelection?: boolean; /** 这份文档的目录：范围那一行里列出来让读者勾。没有目录就是空的。 */ outline?: Chapter[] }>()
const emit = defineEmits<{ start: []; cancel: [] }>()
// 表格直接改这段对话自己的设置（options 是对话状态里的那个对象）。
const options = props.options
const open = ref<string>('scope')
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
// 范围：除了「全文」，把文档的章节列出来勾，可以勾几章；勾的时候把它们写成一句话放进范围里。
const chapters = computed(() => summaryChapters(props.outline))
const chosen = reactive(new Set<number>())
function toggleChapter(index: number) {
  if (chosen.has(index)) chosen.delete(index); else chosen.add(index)
  options.scope = chapterScope([...chosen].sort((a, b) => a - b).map(at => chapters.value[at]!))
}
/** 这一项的值是读者自己写的（不在现成的选项里，也不是勾出来的章节）。 */
const own = (field: Field) => !(field.key === 'scope' && chosen.size) && picked(field).some(item => !choices(field).includes(item))
/** 行尾显示的值：勾了章节就说勾了几章，不把一长串章名挤在一行里。 */
const shown = (field: Field) => field.key === 'scope' && chosen.size ? `${chosen.size} 章` : options[field.key]
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
</script>

<template>
  <section class="sum-card" aria-label="总结设置">
    <header class="sum-head"><h3>总结</h3><p :title="title">{{ title }}</p></header>
    <div class="sum-list">
      <div v-for="field in SUMMARY_FIELDS" :key="field.key" class="sum-row" :class="{ open: open === field.key }">
        <button type="button" class="sum-line" :aria-expanded="open === field.key" @click="open = open === field.key ? '' : field.key">
          <span class="sum-label">{{ field.label }}</span>
          <span class="sum-value" :class="{ none: !shown(field) }">{{ shown(field) || '不指定' }}</span>
          <AppIcon name="arrow" :size="11" class="sum-caret" />
        </button>
        <div v-if="open === field.key" class="sum-options">
          <button v-for="option in choices(field)" :key="option" type="button" class="sum-chip" :aria-pressed="on(field, option)" @click="pick(field, option)" @pointerenter="hover = option" @pointerleave="hover = ''" @focus="hover = option" @blur="hover = ''">{{ option }}</button>
          <p class="sum-explain" aria-live="polite">{{ noteOf(field) }}</p>
          <!-- 范围：这份文档的章节，勾哪几章总结哪几章。 -->
          <div v-if="field.key === 'scope' && chapters.length" class="sum-chapters" role="group" aria-label="按章节选">
            <button v-for="(chapter, index) in chapters" :key="index" type="button" class="sum-chapter" :class="{ sub: chapter.level > 0 }" role="checkbox" :aria-checked="chosen.has(index)" @click="toggleChapter(index)"><i aria-hidden="true"></i><span>{{ chapter.title }}</span><small v-if="chapter.page">{{ chapter.page }}</small></button>
          </div>
          <p v-else-if="field.key === 'scope'" class="sum-nochapters">这份文档没有目录。说个大概就行，助手自己去找。</p>
          <input :value="own(field) ? options[field.key] : ''" type="text" maxlength="200" :placeholder="field.placeholder" :aria-label="`${field.label}：自己写`" @input="write(field, ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="!$event.isComposing && $event.keyCode !== 229 && emit('start')" />
        </div>
      </div>
      <!-- 两个开关。图解与可交互打开后，下面多出两行：放多少、偏向哪一类。 -->
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
        <button type="button" class="sum-line" role="switch" :aria-checked="options.multi" data-tip="文档很长时用：助手一段一段地读、一段一段地写，自己接着写到完，用量更多。不开就是一次写完" @click="options.multi = !options.multi">
          <span class="sum-label wide">分多次写</span><i class="sum-switch" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <footer class="sum-foot"><button type="button" class="sum-cancel" @click="emit('cancel')">不总结了</button><button type="button" class="sum-start" @click="emit('start')">开始总结</button></footer>
    <p class="sum-note">都可以不填。别的要求写在下面的输入框里，按发送也是开始。</p>
  </section>
</template>

<style scoped>
/* 一张实心的表单卡片：字用正经的界面字体，底是不透明的，后面的横线、纹理不穿过字。 */
.sum-card{display:flex;flex-direction:column;max-width:520px;margin:2vh auto 10px;padding:16px 18px 14px;border:1px solid var(--hairline);border-radius:14px;background:var(--surface,var(--canvas));box-shadow:0 1px 2px rgb(0 0 0 / .04),0 10px 26px -18px rgb(0 0 0 / .28);color:var(--ink);font-size:13.5px;line-height:1.5;text-align:left;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
.sum-head{display:flex;flex-direction:column;gap:2px;min-width:0;padding-bottom:12px}
.sum-head h3{margin:0;font-size:17px;font-weight:650;letter-spacing:.02em}
.sum-head p{min-width:0;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:12.5px}
/* 一行一项，行与行之间一道细线。 */
.sum-list{border-top:1px solid var(--hairline)}
.sum-row{border-bottom:1px solid var(--hairline)}
.sum-line{display:flex;align-items:center;gap:12px;width:100%;min-height:40px;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.sum-label{flex:none;width:3.2em;font-size:13.5px;font-weight:550}
.sum-label.wide{flex:1;width:auto}
.sum-value{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--secondary);font-size:13px;text-align:right}
.sum-value.none{color:var(--muted)}
.sum-caret{flex:none;color:var(--muted);rotate:180deg;transition:rotate var(--dur-2) var(--spring-snappy)}
.sum-row.open .sum-caret{rotate:-90deg}
.sum-options{display:flex;flex-wrap:wrap;gap:6px;padding:0 0 13px;animation:sum-open var(--dur-2) var(--ease-out) both}
@keyframes sum-open{from{opacity:0;translate:0 -4px}}
.sum-chip{height:28px;padding:0 12px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:13px;white-space:nowrap;transition:background var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft)}
/* 选项下面的一句说明：指着哪个说哪个。占固定的两行高，换来换去下面的东西不跳。 */
.sum-explain{flex:1 1 100%;min-height:3.1em;margin:1px 0 0;color:var(--secondary);font-size:12.5px;line-height:1.55}
.sum-chip:hover{border-color:color-mix(in srgb,var(--ink) 40%,transparent);color:var(--ink)}
.sum-chip[aria-pressed='true']{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);font-weight:600}
/* 章节：一个不高的小列表，自己滚；每行一个小方框、章名、页码。 */
.sum-chapters{flex:1 1 100%;display:flex;flex-direction:column;max-height:184px;padding:4px;overflow:auto;border:1px solid var(--hairline);border-radius:8px}
.sum-chapter{display:flex;align-items:center;gap:9px;flex:none;width:100%;min-height:30px;padding:0 6px;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left}
.sum-chapter.sub{padding-left:24px;color:var(--secondary)}
.sum-chapter:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.sum-chapter i{flex:none;width:13px;height:13px;border:1.5px solid color-mix(in srgb,var(--ink) 42%,transparent);border-radius:3px;transition:background var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft)}
.sum-chapter span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sum-chapter small{flex:none;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.sum-chapter[aria-checked='true']{font-weight:600}
.sum-chapter[aria-checked='true'] i{border-color:var(--accent);background:var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2.6 6.2 2.3 2.3 4.6-5' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/11px no-repeat}
.sum-nochapters{flex:1 1 100%;margin:0;color:var(--muted);font-size:12.5px}
.sum-options input{flex:1 1 100%;min-width:0;height:32px;padding:0 10px;border:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:8px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;outline:0}
.sum-options input:focus{border-color:var(--accent)}
.sum-options input::placeholder{color:var(--muted)}
/* 开关：一个小滑块。 */
.sum-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:color-mix(in srgb,var(--ink) 20%,transparent);transition:background var(--dur-2) var(--ease-soft)}
.sum-switch::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .25);transition:translate var(--dur-2) var(--spring-snappy)}
.sum-line[aria-checked='true'] .sum-switch{background:var(--accent)}
.sum-line[aria-checked='true'] .sum-switch::after{translate:14px 0}
/* 打开「图解与可交互」后多出来的两行：各是一条三选一。 */
.sum-sub{display:flex;flex-direction:column;gap:8px;padding:0 0 13px;animation:sum-open var(--dur-2) var(--ease-out) both}
.sum-seg{display:flex;align-items:center;gap:0}
.sum-seg>span{flex:none;width:3.2em;color:var(--secondary);font-size:13px}
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
.sum-note{margin:10px 0 0;color:var(--muted);font-size:12px;line-height:1.6}
@media (prefers-reduced-motion:reduce){.sum-card,.sum-options,.sum-sub{animation:none}}
/* 草稿风格：这张表不用手写体，也不描铅笔边——表单要一眼看清。 */
:root[data-style='sketch'] .sum-card{font-family:var(--font-formal);background:var(--paper,#fdfaf0);border-color:color-mix(in srgb,var(--pencil,#2b2a27) 30%,transparent);border-radius:10px}
:root[data-style='sketch'] .sum-card :is(button,input){font-family:var(--font-formal);border-radius:8px}
:root[data-style='sketch'] .sum-line,:root[data-style='sketch'] .sum-cancel{border-radius:0}
:root[data-style='sketch'] .sum-card button:hover:not(:disabled){rotate:none}
:root[data-style='sketch'] .sum-track :deep(.liquid-indicator){background-color:#fff}
</style>
