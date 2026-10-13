# Apple Liquid Glass 文字对比度：官方证据与开智适配建议

研究日期：2026-10-13。本文记录本次实际浏览到的 Apple 官方资料；只做研究，不修改组件样式或渲染逻辑。涉及开智的算法、阈值及实现路线均标为建议，不能当作 Apple 内部实现。

## 主要判断

Apple 的公开方案是同时协调前景文字、玻璃材质和背后内容。可以借鉴它的字体自适应，但不宜把全部可读性责任交给文字变黑、变白。iOS 27 的公开改进尤其强调扩散背后复杂内容和滚动时增强底层隔离，说明可读性来自多个层共同工作。[WWDC26：Platforms State of the Union](https://developer.apple.com/videos/play/wwdc2026/102/)

对于开智，较合适的方向是：短文字工具栏采用局部前景适配；设置、菜单和长篇 AI 对话保持稳定的语义文字色，并由较充分的散射提供安全的局部底色。图案仍可从边缘、间隔和低信息密度区域透出。本文不建议现在把所有组件整体重新上色。

## 版本和证据范围

- 本轮查到 iOS 27 的 Apple 官方使用指南已经描述在 Appearance → Liquid Glass 中使用连续滑块调节 clear / tint，减少透明度或增加对比度开启时，需要先关闭这些辅助功能才能更改该外观偏好。[Apple Support：Adjust iPhone display and text settings，iOS 27](https://support.apple.com/en-euro/guide/iphone/iphd6804774e/27/ios/27)
- 2025 年公开的 Liquid Glass 基础机制仍可用于理解设计意图；不能据此断言 27 版的全部参数与行为完全相同。
- WWDC26 官方说明已经采用 Liquid Glass 的原生应用会获得新的外观、扩散、边缘和辅助功能适配，无须应用自行复刻材质。[WWDC26：Platforms State of the Union](https://developer.apple.com/videos/play/wwdc2026/102/)

## 官方明确公开的机制

### iOS 27 的本轮重点

WWDC26 的相关段落明确介绍了以下变化：

| 公开变化 | 对文字显示的意义 |
| --- | --- |
| 更有效地扩散玻璃背后的复杂内容 | 降低背景细节与字形竞争的程度 |
| 更暗的边缘，以及更亮的镜面高光 | 建立组件轮廓、深度和层间分离；轮廓清晰本身不等于字形对比度达标 |
| 连续 clear → tint 外观滑块 | 用户可在通透感和更有底色的外观间选择 |
| 内容滚到悬浮栏下方时出现较统一的工具栏背衬 | 用更稳定的背衬维持文字可读性与对比度 |
| 降低透明度、增加对比度等系统设置继续作用于材质 | 默认材质之外还有用户选择的可读性方案 |

来源为同一官方会话中 Liquid Glass 更新段落。[WWDC26：Platforms State of the Union](https://developer.apple.com/videos/play/wwdc2026/102/)

SwiftUI 新功能会话还说明系统材质自动响应新的 Liquid Glass 滑块，并在 Mac / iPad 窗口失去活动状态时弱化图标和文字。这种弱化用于表达焦点状态，不能直接类比为所有普通文字都应低透明度。[WWDC26：What’s new in SwiftUI，2:12–3:34](https://developer.apple.com/videos/play/wwdc2026/269/)

### 材质类型决定前景能否安全显示

| 类型 | Apple 公开定位 | 开智的适用推论 |
| --- | --- | --- |
| Regular | 模糊并调整背景亮度；用于可能出现可读性问题、以及侧栏、警告、弹出窗等文字较多的组件 | AI 侧栏、设置弹窗、参数表单优先参考此类型 |
| Clear | 大幅展示媒体背景；明亮背景下可增加暗色 dimming 层 | 适用于少量粗亮符号的媒体浮层，不适合直接让密集正文透在任意 PDF 图案上 |

HIG 对明亮 Clear 背景举例建议增加 35% 不透明度的暗遮罩；内容已经足够暗，或 AVKit 播放控件自带遮罩时，可不额外叠加。[HIG：Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

SwiftUI 的 `Glass.clear` 示例使用 30% 黑色背景，并明确要求在玻璃下方增加 dimming 或其他处理确保可读。这是示例，不是保证所有背景、字号都达标的固定数值。[SwiftUI：Glass.clear](https://developer.apple.com/documentation/swiftui/glass/clear)

### 短文字与大面积文字采用不同稳定性策略

HIG Color 明确说明：小型工具栏、标签栏可随背后内容切换材质明暗，默认单色符号和文字也相应变深或变浅；较大的侧栏采用更不透明的表面以承载较复杂内容。色彩应主要用于真正需要强调的动作或状态，并避免标签颜色与丰富背景近似。[HIG：Color，Liquid Glass color](https://developer.apple.com/design/human-interface-guidelines/color)

WWDC25 进一步公开了以下行为：小玻璃可切换明暗；大菜单和侧栏不会整块频繁翻转，以免干扰；阴影、tint 和动态范围会随内容改变；普通玻璃上的字形也有相应前景处理。自适应 tint 会生成随背景亮度变化的一组色调。Clear 不具有与 Regular 相同的自适应行为。[WWDC25：Meet Liquid Glass，6:00 与 10:31 章节](https://developer.apple.com/videos/play/wwdc2025/219/)

这些资料没有公开采样尺寸、亮度阈值、迟滞范围、更新频率或具体着色器公式，因此不应把自行计算平均亮度再翻色称为 Apple 的原始算法。

### 前景文字是材质系统的一部分

SwiftUI 的 `glassEffect` 文档明确说该修饰符既在视图后绘制玻璃，也在视图上施加前景效果；它不仅是一层透明底板。[SwiftUI：glassEffect(_:in:)](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:))

SwiftUI 会话说明玻璃上的文字会自动获得随背景调整的 vibrant 前景色；玻璃 tint 也能随背后内容适配。[WWDC25：Build a SwiftUI app with the new design，18:43 与 19:12](https://developer.apple.com/videos/play/wwdc2025/323/)

UIKit 会话则说明将标签放到 visual effect view 的 `contentView` 后，标签会根据 `textColor` 获得 vibrancy；使用动态颜色时，玻璃与内容可以随背景切换外观。它还明确指出较大玻璃更不透明，较小玻璃更通透。[WWDC25：Build a UIKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/284/)

SwiftUI 标准 `Material` 文档将 vibrancy 描述为前景与背景的情境相关混合，能改进对比度。该标准材质文档还指出自定义 `foregroundStyle` 会禁用原本的 vibrancy，而默认前景上的层次样式（如 secondary）保留该行为。此处是标准 Material 的公开契约，不应无证据扩大成所有 Liquid Glass 自定义着色的禁止规则。[SwiftUI：Material](https://developer.apple.com/documentation/swiftui/material)、[SwiftUI：foregroundStyle(_:)](https://developer.apple.com/documentation/swiftui/view/foregroundstyle(_:))

AppKit 的对应机制也明确区分主、次、三、四级语义标签色：主级对比度最高，四级最低；灰度前景通常更适合 vibrancy。此处可为开智建立主次文字 token 提供参考，但 AppKit 振色效果不是 Windows CSS 的现成功能。[AppKit：NSVisualEffectView](https://developer.apple.com/documentation/appkit/nsvisualeffectview)

### 底层隔离和辅助功能同样重要

Adopting Liquid Glass 文档要求优化滚到控件下的内容可读性。原生工具栏默认带 scroll edge effect；自定义栏可通过 `safeAreaBar` 或 `UIScrollEdgeElementContainerInteraction` 接入。过度自定义背景可能覆盖或干扰系统材料与滚动边缘效果。[Apple：Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)

WWDC25 公开：减少透明度会让玻璃更毛、更遮挡背后内容；增加对比度会强化黑白与对比边界；减少动态效果会降低效果强度并禁用弹性行为。[WWDC25：Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)

SwiftUI `accessibilityReduceTransparency` 的通用约定要求窗口等背景在该偏好为真时应采用不透明背景。因此项目提供“减少透明度”时，不应只是把玻璃稍微加深几个百分点。[SwiftUI：accessibilityReduceTransparency](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducetransparency)

动态颜色还必须保持动态：UIKit 文档指出语义 `UIColor` 可自动适应外观，而提前抽出的具体色值或 `CGColor` 需要自己响应后续主题变化。开智虽然不是 UIKit，这个状态生命周期问题对之前的深浅切换颜色残留尤其有参考价值。[UIKit：UI element colors](https://developer.apple.com/documentation/uikit/ui-element-colors)

## 为什么不能只靠字体补偿

以下为项目分析，并非 Apple 披露的算法。

1. **模糊只会移除细节，不能保证平均亮度足够。** 一大片灰色背景即使模糊很强，白色小字仍可能没有足够对比度。
2. **平均亮度不代表文字下面的最差位置。** 黑白相间的图表可具有稳定的平均值，但其中一部分字形总会落到同色背景上。只算全组件平均值会漏掉此情况。
3. **单一黑字或白字未必能同时适应整个段落。** 长篇 AI 正文与大型设置面板应该优先保持稳定的阅读色；必要时调整字下材质的亮度范围与散射程度。
4. **阴影与边缘主要增加悬浮感。** 组件外圈再清晰也无法直接改善中部文字与图案的局部对比；不应拿更亮边缘代替实际字下检测。
5. **不要对文字容器应用同一背景折射。** 可以使边缘、底板折射，但正文应保持普通 DOM 字形渲染，以保留中文细节、选择、缩放和辅助阅读。

### 35% 遮罩的数值检查

普通文字的 WCAG 2.2 AA 对比度要求为至少 4.5:1；大字为 3:1。Web 的大字定义为至少 18 pt 普通字或 14 pt 粗体，而不是任意粗体都可降到 3:1。[W3C：Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

在简化模型中，采用 sRGB 编码通道进行普通 alpha 合成，不考虑真实玻璃的亮度变换、高光、散射：纯白背景覆盖 35% 黑色后为通道 0.65，相对亮度约 0.380；白字对比度约 `1.05 / (0.380 + 0.05) = 2.44:1`。同模型约 54% 黑色遮罩才得到约 4.59:1。这是按 W3C 公式计算的例子，不是对 Apple 实际材质的测量，更不是要求开智所有组件固定加 54% 遮罩。[W3C：相对亮度和对比度公式](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

因此 30% / 35% 仅可作为材料组合设计的参考，最后仍需验证最终显示背景。使用与背景一致的清浅玻璃以及深色字时，也可以保持高对比而无需大范围黑色罩层。

## 开智后续可采用的准备方案

以下均为建议，待用户确定视觉方向后实施。

| 组件 | 前景建议 | 背景建议 |
| --- | --- | --- |
| 顶栏、阅读工具栏、少量字标签 | 以语义主色为基准；背景足够极端且稳定时整体选深字或浅字 | 轻散射；PDF 滚入文字后方时加强局部滚动隔离 |
| AI 侧栏、设置页面、长菜单 | 使用稳定的主文字与次文字等级，减少局部翻色 | 更充分的散射与亮度范围压缩；有复杂图案时仅增强必要区域 |
| 输入框、下拉列表 | 输入、选项与选中态保证同一阅读基准 | 下拉浮层单独声明语义表面，不依赖父组件颜色或浏览器原生菜单默认色 |
| 主动作、选中标签 | 用灰度、边框、焦点线或有限强调色体现状态 | 不为了玻璃感大量叠加独立 glass-on-glass |

材质和文字状态应从同一份“主题、用户透明度偏好、背景、组件角色”输入计算，避免全局 CSS 的主题色与组件内写入的内联颜色各自更新。切换主题时立刻撤销旧补偿，再基于新状态重算；不要把旧采样结果复用于新主题。

对比检测应选实际文字区域，并看局部亮度范围或分位数，同时记录背景纹理变化。更新可由背景图切换、主题切换、透明度改变、滚动与尺寸变化触发；应合并更新并加入稳定区间，防止文字经过阈值时频繁黑白切换。具体分位数、时间间隔、迟滞阈值是项目调参项，Apple 没有公开这些数值。

逐步增强时可先改善文字等级和主题状态管理，再做局部自适应，最后加最少量字下辅助背衬。建议一开始以普通可操作文字 4.5:1 为目标；小字体可留更多余量。标识功能的图标与必要焦点/组件状态一般按 3:1 检查。[W3C：Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

## Windows / WebView 不能直接照搬的部分

- SwiftUI、UIKit、AppKit 的材质与前景效果属于 Apple 原生 UI 渲染系统，Windows Tauri WebView 不能调用 `UIGlassEffect`、`NSGlassEffectView` 或 SwiftUI `glassEffect`。
- 单纯 CSS `backdrop-filter` 模糊和透明填色，并不自动获得 Apple 对文字的 vibrancy、尺寸分类、明暗策略与系统辅助功能适配。
- `mix-blend-mode: difference` 不等价于 Apple 公开的 vibrant 前景处理，也无法自行保证指定对比度；可能随彩色背景变成意料之外的颜色。
- 背景图片、PDF canvas 等可针对性采样；不能假设普通 JavaScript 可廉价获取整个浏览器最终合成场景的所有字下像素。跨源图片、嵌套材质、折射、主题滤镜等需要单独验证。该条是 Web 实现约束分析。
- “减少透明度”“增强对比度”“减少动态效果”应作为跨平台功能单独接入或提供明确设置，不能因 iOS 原生自动响应而推定 Windows 自动完成。
- Apple 未公开完整着色器、背景检测或前景颜色映射算法。可借鉴功能关系与审美节制，不能宣称本项目实现了 Apple 的原算法。

## 后续验证场景

至少覆盖：白底 PDF、暗色 PDF、黑白图表、彩色扫描件、亮/暗用户图片底板；透明度从最通透到最有底色；浅 → 深 → 浅与深 → 浅 → 深连续切换；弹窗、下拉列表、滚动工具栏、侧栏长对话；输入、悬停、选中、键盘焦点；减少透明度与增强对比度。可读性检测与 PDF 渲染性能检查应同时保留，避免通过连续采样拖慢阅读滚动。

这份清单是项目验证建议。当前文档只完成研究，不代表上述候选优化已经实现或测试。
