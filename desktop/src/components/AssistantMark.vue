<script setup lang="ts">
import { CLAUDE_PATH, DEEPSEEK_PATH } from './assistant-glyphs'

// 阅读助手的形象：内置小螃蟹动图、Claude、ChatGPT、DeepSeek，或用户自己的图片/动图。
withDefaults(defineProps<{ kind: string; image?: string | null; size?: number }>(), { size: 52 })
</script>

<template>
  <span class="assistant-mark" :class="`mark-${kind}`" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <img v-if="kind === 'custom' && image" :src="image" alt="" draggable="false" />
    <svg v-else-if="kind === 'claude'" viewBox="0 0 24 24"><path :d="CLAUDE_PATH" /></svg>
    <svg v-else-if="kind === 'deepseek'" viewBox="0 0 24 24"><path :d="DEEPSEEK_PATH" /></svg>
    <svg v-else-if="kind === 'chatgpt'" viewBox="0 0 24 24" class="knot">
      <g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
        <rect v-for="angle in [0, 60, 120, 180, 240, 300]" :key="angle" x="9" y="2.6" width="6" height="11" rx="3" :transform="`rotate(${angle} 12 12)`" />
      </g>
    </svg>
    <!-- 像素小螃蟹：身体轻轻起伏，八条腿交替迈步，偶尔眨眼。 -->
    <svg v-else viewBox="0 0 24 24" class="crab" shape-rendering="crispEdges">
      <g class="crab-body">
        <rect x="3" y="4.5" width="18" height="12" />
        <rect x="0" y="10.5" width="3" height="3" />
        <rect x="21" y="10.5" width="3" height="3" />
        <g class="crab-eyes"><rect x="6" y="7.5" width="1.5" height="3" /><rect x="16.5" y="7.5" width="1.5" height="3" /></g>
      </g>
      <g class="legs legs-a"><rect x="3" y="16.5" width="1.5" height="3" /><rect x="7.5" y="16.5" width="1.5" height="3" /><rect x="15" y="16.5" width="1.5" height="3" /><rect x="19.5" y="16.5" width="1.5" height="3" /></g>
      <g class="legs legs-b"><rect x="4.5" y="16.5" width="1.5" height="3" /><rect x="9" y="16.5" width="1.5" height="3" /><rect x="13.5" y="16.5" width="1.5" height="3" /><rect x="18" y="16.5" width="1.5" height="3" /></g>
    </svg>
  </span>
</template>

<style scoped>
.assistant-mark{display:grid;place-items:center;flex-shrink:0;border-radius:var(--r-lg);overflow:hidden}
.assistant-mark img{width:100%;height:100%;object-fit:cover}
.assistant-mark svg{width:62%;height:62%}
.mark-claude{background:#f4efe6;color:#d97757}
.mark-claude svg,.mark-deepseek svg{fill:currentColor}
.mark-deepseek{background:#eef1ff;color:#4d6bfe}
.mark-chatgpt{background:#fff;color:#111;box-shadow:inset 0 0 0 1px rgb(0 0 0 / .08)}
.mark-crab{background:transparent}
.mark-crab svg{width:88%;height:88%;fill:#d97757;overflow:visible}
.mark-crab .crab-eyes rect{fill:#2b1a12}
.crab-body{animation:crab-bob .9s steps(2) infinite}
.crab-eyes{transform-origin:12px 9px;animation:crab-blink 4.2s steps(1) infinite}
.legs-a{animation:crab-step .45s steps(1) infinite}
.legs-b{animation:crab-step .45s steps(1) infinite reverse}
@keyframes crab-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.75px)}}
@keyframes crab-step{0%{opacity:1}50%{opacity:0}}
@keyframes crab-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@media(prefers-reduced-motion:reduce){.crab-body,.crab-eyes,.legs-a,.legs-b{animation:none}.legs-b{opacity:0}}
</style>
