# 开智：Liquid Glass 文字对比度研究与后续方案

研究日期：2026-10-13。已实际查阅 Apple 官方 HIG、WWDC25/26、SwiftUI/UIKit 文档，以及四个开源项目的 README、许可证和相关源码。官方证据详见 [Apple 资料](apple-liquid-glass-contrast.md)，固定源码版本和实现细节详见 [开源研究](opensource-liquid-glass-contrast.md)。本轮实现的是快捷提问自定义；以下文字显示方案供下一轮试验，不改变当前玻璃视觉。

## 结论

Apple 用多个层共同保持文字清晰：前景文字与图标适配、材质的亮度与散射调节、内容与控件的隔离、滚动边缘处理，以及辅助功能。字色适配可以作为开智的第一步，但任意图片和 PDF 背景下，仅选择黑字或白字无法保证每一处字形都清晰。把折射做得更真实，也不会自动补齐文字对比度。

最合适的方向是：**清晰文字层独立于光学层；短标签允许受约束的字体补偿；长文本保持稳定语义色；遇到字体无法解决的背景才增加局部保护。** 继续遵守选中按钮只改变中性底色、字体不随选中反色的现有约定。

## Apple 公开了哪些机制

1. **字色、图标和材质协同适配。** Apple 公开说明，小工具栏和标签栏可随背景切换明暗，前景符号和字形也会适配。较大的菜单和侧栏会调整，但不整块切换明暗，以避免大面积变化干扰阅读。[Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
2. **Regular 与 Clear 用途不同。** Regular 提供自适应；Clear 更通透，适合媒体上少量粗亮控件，需要视背景加入 dimming。不能把 Clear 当作密集文字组件的默认材料。[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Glass.clear](https://developer.apple.com/documentation/swiftui/glass/clear)
3. **前景有语义层级。** 原生 glassEffect 同时作用于背后材质和前景，默认前景能使用适配背景的 vibrant 表现。主文字、辅助文字、操作色不宜全部写死成同一透明灰色；普通 CSS 混合模式不能直接等同这一系统行为。[glassEffect](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:))、[SwiftUI 中的 Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/323/)
4. **27 系列继续加强阅读隔离。** WWDC26 明确介绍更充分地扩散复杂背景、更暗的边缘和更亮的高光，以及 clear→tint 连续滑块；内容滚入悬浮栏下方时，统一的工具栏背衬提高文字可读性。[Platforms State of the Union，Liquid Glass 更新](https://developer.apple.com/videos/play/wwdc2026/102/)
5. **滚动与辅助功能属于正式方案。** Scroll edge effect 将滚动内容逐渐融入背景，必要时采用更均匀的隔离；减少透明度、增强对比度和减少动态效果也会改变材质表现。[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)、[减少透明度环境值](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducetransparency)

Apple 未公开背景采样尺度、判断阈值、稳定时间和完整着色器公式。下面提出的取样、迟滞和缓存参数是开智的候选设计，不是对 Apple 私有算法的复现。

## 开源项目能提供什么

| 项目 | 查到的文字机制 | 适合借鉴的部分 |
| --- | --- | --- |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react/blob/ac48eab18d1f7f444ae30002d240cae29c863a21/src/index.tsx) | 文字与折射层分离，但文字固定白色；overLight 由调用者指定，调整材质与遮层，未自动计算字下对比度 | 文字保持清晰，折射集中在材料层和边缘 |
| [Meapri/liquid-glass-web](https://github.com/Meapri/liquid-glass-web/blob/1613f8311dbc31bc2331afcfe51a143c56dd6308/src/core/LiquidGlass.ts) | 三个 DOM 点取 backgroundColor，依平均值和迟滞换明暗；不直接读取图片、渐变或 PDF canvas 的内容 | 共享事件调度和有迟滞的决策；不能照搬其取样方法 |
| [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/destinations/AdaptiveLuminanceGlassContent.kt) | 示例真实捕获 backdrop 并缩成 5×5，用平均亮度切换字色和材质；没有最低对比度检查 | 有明确来源图层，前景在材质之后独立绘制 |
| [chrisbanes/haze](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/haze-glass/src/commonMain/kotlin/dev/chrisbanes/haze/glass/GlassStyle.kt) | 处理 Regular/Clear 材质色调、对比与光学效果，前景由应用提供；材质 increaseContrast 不等于文字验证 | 按用途选择材质、缓存来源图层、提供明确降级路径 |

前两项为 MIT，后两项为 Apache-2.0。它们都是第三方实现，不能证明 Apple 内部算法。无需为这些研究把 Vue 改成 React，或引入 Android 渲染框架。

## 当前实现为什么还会出现不清楚的文字

目前 [glass-contrast.ts](../../src/ui/glass-contrast.ts) 已采用线性化 sRGB 计算，并考虑图片 cover 布局、祖先底色、主题恢复与迟滞；这些能力应保留。主要边界是：

- **选择较高的比率，不等于达到最低值。** 现有深字 #151918 和浅字 #f2f5f3 的相对亮度分别约为 0.0092064、0.9065313。按正常小字 4.5:1 目标计算，背景亮度在约 0.16256–0.21643 之间时，两种字色都不足；交点的最佳比率也只有约 4.02:1。数值直接由当前常量及 W3C 公式复算，不是截图测量或 Apple 参数。
- **平均背景掩盖局部问题。** 64×64 缩图和区域平均 RGB 能识别整体明暗，却会抹掉黑白分区与细纹；一个按钮的平均值合适，不代表某个字紧邻的背景也合适。
- **取样模型与最终画面有差别。** 当前没有完整模拟 sheen、实际 backdrop blur/saturate、高光叠层；默认底板、弹窗和 PDF 正文也不在上传底板取样的覆盖范围。它们需要各自验证。
- **语义等级被压平。** 当前补偿将主文字、控件、辅助文字统一为同色；能减少弱字消失，但后续应保留层级，避免简单以低 opacity 重新制造弱文字。

普通小字建议以至少 4.5:1 为验证目标；符合标准定义的大文字可使用 3:1。对比度应对应字形及其紧邻的最终背景，不能只看组件平均色。[W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[G18 测量方法](https://www.w3.org/WAI/WCAG21/Techniques/general/G18)

还有一个容易误用的数字：HIG 给 Clear 举例的 35% 暗遮罩是设计建议，不是通用安全门槛。简化为白底、35% 黑色 alpha 遮罩、纯白字时，按常规 sRGB 合成和相对亮度公式计算，比率只有约 2.44:1；真实原生材料还有额外处理，因此这个反例也不能当作 Apple 实际效果的测量。[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[W3C 公式](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## 建议下一轮怎样试

| 场景 | 文字策略 | 材质策略 |
| --- | --- | --- |
| 阅读工具栏、文件标签、快捷按钮 | 一个控件中的文字和图标统一选择字色极性；按局部对比度适配，选中与悬停保持稳定 | 保持通透与浮起感；高光避开字形区域 |
| AI 侧栏 | 控件可以局部适配；回答正文保持稳定的主次语义色，避免阅读中整段反复翻色 | 参考 Regular 的散射与稳定性，图案主要从留白和边缘透出 |
| 设置、菜单、输入框 | 稳定的主题文字色，独立验证辅助说明、占位提示与原生菜单 | 延续茶色毛玻璃；文字区域需要足够的背景隔离 |
| 文档卡片与元数据 | 标题、元数据分别按实际文字区域判断；通过字重和字号保留层级 | 减少多重玻璃叠放，控制高光覆盖 |

实施顺序建议如下：

1. **先分层。** 光学折射、色散、高光只作用于背景和边缘，文字保持清晰。将高光放在文字层下方，或限制到不会经过字形的区域。
2. **再改判断。** 复用已经解码的底板，缓存有界的局部亮度分布；对文字行或控件组取多个样本，比较候选字色的局部最差值。低分位可用于排序和抵抗噪声，不能替代关键字区的最低要求。
3. **让迟滞带门槛。** 只有旧字色仍达标时才保留它；不达标时重新决策。主题、底板、文档的主动切换清除旧迟滞。不要用每个字各自翻黑白来掩盖混合背景问题。
4. **字体优先，必要时局部保护。** 先试更接近黑白的前景、合适字重与很薄的中性描边。若候选字色均不足，只保护字下小区域或使用更稳定的 Regular/毛玻璃材料。描边与阴影仍需测量，不自动算达标；无需恢复全界面的大块底色补偿。
5. **测量过渡。** 黑字渐变成白字会经过中灰，平滑动画可能产生短暂低对比度。先验证静态安全，再比较离散换色与受保护的短过渡。

CSS 没有通用接口直接读取任意最终 backdrop-filter 合成像素。开智可用已知图片、底色和显示滤镜建立估计模型，再用测试截图校准。只有确实覆盖 PDF 的组件才有必要复用已有可见 canvas；不要为取样重新渲染 PDF，也不做整窗口截屏轮询或持续 GPU→CPU 读回。

## 验证与决策标准

先用现有算法作基线，再分别比较「更接近黑白的字色」「多点与门槛决策」「局部保护层」，避免同时大改而无法判断收益。

测试背景包括纯黑/纯白、扫描件、深色 PDF 滤镜、彩色封面、半黑半白、棋盘与细条纹、饱和色、中灰渐变；交叉测试透明度 0/50/100%、主题往返、侧栏开合、标签切换、悬停、键盘焦点和高 DPI。记录关键文字区最差对比度、低对比持续时间、换色次数、CPU/GPU 时间与 PDF 切换耗时。

性能保持事件驱动、共享调度、有界缓存；隐藏面板不取样，静止页面无周期轮询。减少透明度、高对比度和强制系统颜色优先。具体采样频率和缓存大小由开智的 Windows 实测决定，不照搬开源演示或猜测 Apple 参数。

本轮先完成快捷提问功能并保存研究依据。后续优先做「文字与高光分层 + 多点对比度判断」的小范围试验，再决定是否需要局部材质保护。
