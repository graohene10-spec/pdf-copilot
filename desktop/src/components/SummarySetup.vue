<script setup lang="ts">
// 总结开始前的那张表。要素有六七项，全摊开会是一片按钮，所以平时每项只占一行：左边名字，右边现在的值（没填是淡淡的「不指定」）。
// 点哪一行哪一行展开，一次只开一行：里面是几个现成的选项和一个自己写的空。范围最说不清，默认先开着它。
// 别的要求读者直接写在下面的输入框里，和这张表一起发出去。
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { SUMMARY_FIELDS, type SummaryOptions } from '../ai/summary'

type Field = typeof SUMMARY_FIELDS[number]
const props = defineProps<{ title: string; options: SummaryOptions; hasSelection?: boolean }>()
const emit = defineEmits<{ start: []; cancel: [] }>()
// 表格直接改这段对话自己的设置（options 是对话状态里的那个对象）。
const options = props.options
const open = ref<string>('scope')
const choices = (field: Field) => field.key === 'scope' && props.hasSelection ? [...field.options, '选中的内容'] : field.options
const picked = (field: Field) => options[field.key] ? options[field.key].split('、').filter(Boolean) : []
/** 这一项的值是读者自己写的（不在现成的选项里）。 */
const own = (field: Field) => picked(field).some(item => !choices(field).includes(item))
function pick(field: Field, option: string) {
  const list = own(field) ? [] : picked(field)
  if (!field.many) { options[field.key] = list[0] === option ? '' : option; return }
  const at = list.indexOf(option)
  if (at >= 0) list.splice(at, 1); else list.push(option)
  options[field.key] = list.join('、')
}
</script>

<template>
  <section class="sum-card" aria-label="总结设置">
    <header class="sum-head"><h3>总结</h3><p :title="title">{{ title }}</p></header>
    <div class="sum-list">
      <div v-for="field in SUMMARY_FIELDS" :key="field.key" class="sum-row" :class="{ open: open === field.key }">
        <button type="button" class="sum-line" :aria-expanded="open === field.key" @click="open = open === field.key ? '' : field.key">
          <span class="sum-label">{{ field.label }}</span>
          <span class="sum-value" :class="{ none: !options[field.key] }">{{ options[field.key] || '不指定' }}</span>
          <AppIcon name="arrow" :size="11" class="sum-caret" />
        </button>
        <div v-if="open === field.key" class="sum-options">
          <button v-for="option in choices(field)" :key="option" type="button" :aria-pressed="!own(field) && picked(field).includes(option)" @click="pick(field, option)">{{ option }}</button>
          <input :value="own(field) ? options[field.key] : ''" type="text" maxlength="200" :placeholder="field.placeholder" :aria-label="`${field.label}：自己写`" @input="options[field.key] = ($event.target as HTMLInputElement).value" @keydown.enter.prevent="!$event.isComposing && $event.keyCode !== 229 && emit('start')" />
        </div>
      </div>
    </div>
    <div class="sum-switches">
      <button type="button" role="switch" :aria-checked="options.ui" data-tip="在文档里用 Intelligent UI：图解，和可以拖动、筛选的演示" @click="options.ui = !options.ui"><i aria-hidden="true"></i>图解与可交互</button>
      <button type="button" role="switch" :aria-checked="options.multi" data-tip="文档很长时用：助手一段一段地读、一段一段地写，自己接着写到完，用量更多。不选就是一次写完" @click="options.multi = !options.multi"><i aria-hidden="true"></i>分多次写</button>
    </div>
    <footer class="sum-foot"><button type="button" class="sum-cancel" @click="emit('cancel')">不总结了</button><button type="button" class="sum-start" @click="emit('start')">开始总结</button></footer>
    <p class="sum-note">都可以不填。别的要求写在下面的输入框里，按发送也是开始。</p>
  </section>
</template>

<style scoped>
.sum-card{display:flex;flex-direction:column;max-width:520px;margin:3vh auto 8px;padding:0 6px;text-align:left;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
.sum-head{display:flex;align-items:baseline;gap:12px;min-width:0;padding-bottom:12px}
.sum-head h3{flex:none;margin:0;font-size:20px;font-weight:700;letter-spacing:.14em}
.sum-head p{min-width:0;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:12.5px}
/* 一行一项，行与行之间一道细线。 */
.sum-list{border-top:1px solid var(--hairline)}
.sum-row{border-bottom:1px solid var(--hairline)}
.sum-line{display:flex;align-items:center;gap:12px;width:100%;height:38px;padding:0 2px;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.sum-label{flex:none;width:3em;color:var(--secondary);font-size:12.5px;letter-spacing:.14em}
.sum-value{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;text-align:right}
.sum-value.none{color:var(--muted);opacity:.7}
.sum-caret{flex:none;color:var(--muted);rotate:180deg;transition:rotate var(--dur-2) var(--spring-snappy)}
.sum-row.open .sum-caret{rotate:-90deg}
.sum-line:hover .sum-label,.sum-row.open .sum-label{color:var(--ink)}
.sum-options{display:flex;flex-wrap:wrap;gap:6px;padding:2px 2px 13px;animation:sum-open var(--dur-2) var(--ease-out) both}
@keyframes sum-open{from{opacity:0;translate:0 -4px}}
.sum-options button{height:26px;padding:0 11px;border:1px solid var(--hairline);border-radius:999px;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:12px;white-space:nowrap;transition:background var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft)}
.sum-options button:hover{border-color:color-mix(in srgb,var(--ink) 34%,transparent);color:var(--ink)}
.sum-options button[aria-pressed='true']{border-color:color-mix(in srgb,var(--accent) 60%,transparent);background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--ink);font-weight:650}
.sum-options input{flex:1 1 100%;min-width:0;height:30px;margin-top:2px;padding:0 2px;border:0;border-bottom:1px dashed color-mix(in srgb,var(--ink) 26%,transparent);border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;outline:0}
.sum-options input:focus{border-bottom-style:solid;border-bottom-color:var(--accent)}
.sum-options input::placeholder{color:var(--muted)}
/* 两个开关：一个小圆点，开着是实心的。 */
.sum-switches{display:flex;flex-wrap:wrap;gap:6px 22px;padding:13px 2px 0}
.sum-switches button{display:inline-flex;align-items:center;gap:8px;height:24px;padding:0;border:0;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:12.5px;cursor:pointer}
.sum-switches i{width:10px;height:10px;border:1.5px solid color-mix(in srgb,var(--ink) 40%,transparent);border-radius:50%;transition:background var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft),scale var(--dur-2) var(--spring-snappy)}
.sum-switches button[aria-checked='true']{color:var(--ink)}
.sum-switches button[aria-checked='true'] i{border-color:var(--accent);background:var(--accent);scale:1.1}
.sum-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:16px}
.sum-cancel{height:30px;padding:0 2px;border:0;background:none;box-shadow:none;color:var(--muted);font:inherit;font-size:12px}
.sum-cancel:hover{color:var(--ink)}
.sum-start{height:34px;padding:0 22px;border:0;border-radius:999px;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff);font:inherit;font-size:13px;font-weight:650;letter-spacing:.1em;transition:filter var(--dur-1) var(--ease-soft),scale var(--dur-2) var(--spring-snappy)}
.sum-start:hover{filter:brightness(1.06)}
.sum-start:active{scale:.97}
.sum-note{margin:12px 0 0;color:var(--muted);font-size:11.5px;line-height:1.6;opacity:.85}
@media (prefers-reduced-motion:reduce){.sum-card,.sum-options{animation:none}}
</style>
