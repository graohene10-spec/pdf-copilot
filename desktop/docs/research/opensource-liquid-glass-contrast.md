# 液态玻璃开源实现与开智文字对比度准备

研究日期：2026-10-13。范围：实际阅读四个项目的官方 README、许可证和相关实现源码；只读分析开智当前样式与取样逻辑。本报告没有修改材质或文字显示代码。下列开源实现是第三方复现，不能据此断言 Apple 内部实现、阈值或渲染管线。

结论：折射、色散和更漂亮的高光并不保证文字对比度。四个实现中，有的只提供材质，有的确实切换黑白文字，但均未在所检查的路径中证明每段文字达成最低对比度。开智适合保留文字和材质的独立层，先升级最终字下背景的估计和对比度决策，再考虑强折射。

验证基准采用 [W3C WCAG 2.2 文字最低对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)：普通文字4.5:1、大文字3:1；功能图标等参考 [非文字对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。正式比率使用实际合成前景色和紧邻背景色，不把抗锯齿边缘像素当作文字本色；截图用于校准背景、叠层和视觉可读性。灰字过渡也须验证。以下是开发测试目标，不意味着开智当前已有认证。

## 已核实的四个项目

| 项目及固定版本 | 许可证 | 实际机制 | 对开智可借鉴之处与边界 |
| --- | --- | --- | --- |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react/tree/ac48eab18d1f7f444ae30002d240cae29c863a21) | [MIT](https://github.com/rdev/liquid-glass-react/blob/ac48eab18d1f7f444ae30002d240cae29c863a21/LICENSE) | SVG 位移/色散与 backdrop 模糊，材质独立于前景。`overLight` 是调用方布尔值，改变模糊、阴影和黑色遮层；文本仍使用 `text-white`。 | 可参考文字保持清晰、边缘独立高光。它没有自动背景像素采样，也没有黑白墨色比率检查；不应把 `overLight` 理解成自动可读性。README 明示 Safari/Firefox 的位移不完整。 |
| [Meapri/liquid-glass-web](https://github.com/Meapri/liquid-glass-web/tree/1613f8311dbc31bc2331afcfe51a143c56dd6308) | [MIT](https://github.com/Meapri/liquid-glass-web/blob/1613f8311dbc31bc2331afcfe51a143c56dd6308/LICENSE) | SVG 位移、模糊和边缘反光；自适应外观以三个 DOM 点读取 `backgroundColor`，切换标签字色与材质。 | 共享节流、迟滞、不同语义组件采用不同材质值得参考。取样不是实际屏幕像素：不读 PDF canvas、图片或渐变，半透明层也未完整合成。透明度不足或解析失败回退系统外观。因此不能替代现有图片取样。 |
| [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass/tree/65ab177e90e5c1d8c62e70cf7755841982da65f6) | [Apache-2.0](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/LICENSE) | Compose 独立 backdrop 图层，模糊/透镜后再绘制前景。亮度演示实际获取 backdrop 位图并缩成 5×5，依平均亮度改变字色和材质参数。 | 真正捕获了来源像素，适合参考来源图层缓存；示例不是成熟对比度保证器。`vibrancy()` 仅增加饱和度，不是 Apple 文字活力算法。 |
| [chrisbanes/haze](https://github.com/chrisbanes/haze/tree/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3) | [Apache-2.0](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/LICENSE) | 独立來源、缓存、模糊、折射、色调、边缘照明；Regular/Clear 随系统外观选择材质参数，前景内容由应用提供。 | 可参考按用途区分材质、保留已渲染图层及能力降级。其 `increaseContrast` 是材质色调/边缘调整，不测前景文字的 WCAG 比率。不能因为存在 AccessibilitySettings 就认为文字已通过验证。 |

四个仓库的固定版本来自当日公开 GitHub API 的默认分支树 SHA，相关 raw 源码均成功只读获取；没有运行或安装第三方项目。浏览器页面缓存可能与固定 SHA 时间不同，详细结论以固定源码为准。

## 源码揭示的关键细节

### rdev：光学层和文字分离，但是没有自动文字补偿

[src/index.tsx](https://github.com/rdev/liquid-glass-react/blob/ac48eab18d1f7f444ae30002d240cae29c863a21/src/index.tsx) 的 `GlassContainer` 将 `glass__warp` 设为绝对定位，前景内容以 `position: relative; zIndex: 1` 绘制，避免字形被位移。`overLight` 同时增大背景模糊、增强投影、减半位移，并添加黑色背景/overlay。前景写死 `text-white`；该分支不会自动计算背景或设置黑色文字。

这是值得保留的层次结构，而不是可直接复制的可访问性方案。该库与 Vue 无直接框架兼容性；开智可以借鉴其图层关系，不需要引入 React 或整个库。鼠标移动触发 React 状态更新、调整位移和多个高光层，实际开销需按组件数量测量，不能仅凭 SVG/GPU 判断低成本。[README](https://github.com/rdev/liquid-glass-react/blob/ac48eab18d1f7f444ae30002d240cae29c863a21/README.md) 也将 shader 模式描述为稳定性较弱的选择。

### Meapri：自适应命名不代表实际合成像素可见

[LiquidGlass.ts](https://github.com/Meapri/liquid-glass-web/blob/1613f8311dbc31bc2331afcfe51a143c56dd6308/src/core/LiquidGlass.ts) 的 `sampleBackdropLuminance()` 取中心、左上角、右下角三个点，通过 `elementsFromPoint()` 找背景色；`parseBgLuminance()` 仅解析 `rgb/rgba` 并要求 alpha≥0.5，直接对编码 RGB 加权，并没有先线性化 sRGB。三个结果取平均，阈值≤0.45进入深材质、≥0.55进入浅材质，之间保留旧状态。[样式](https://github.com/Meapri/liquid-glass-web/blob/1613f8311dbc31bc2331afcfe51a143c56dd6308/src/styles/liquid-glass.css) 为自适应浅材质设置深字；默认白字。

桌面共享取样节流为 96ms，移动端为 180ms；尺寸变化和滚动驱动刷新，而非所有组件永久逐帧循环。颜色、材质与阴影采用 460ms 过渡，这能减少突变，但过渡中的灰字仍需要验证。[README](https://github.com/Meapri/liquid-glass-web/blob/1613f8311dbc31bc2331afcfe51a143c56dd6308/README.md) 的高级跨浏览器替代路径增加独立场景来源和同步代价，不能把“没有 WebGL”的常规路径描述推广到所有可选路径。

推断：PDF canvas 的 CSS 背景色与其绘制内容完全可能不同；因此这类 DOM 颜色取样在黑白论文、扫描件、反色 PDF 上会误判。读到某个半透明 div 的背景色也不等于读到多层合成后的像素。

### Kyant0：真正 backdrop 取样，但平均亮度、文字渐变和反馈环仍有限制

[AdaptiveLuminanceGlassContent.kt](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/destinations/AdaptiveLuminanceGlassContent.kt) 在绘制 backdrop 时记录图层，通过 `toImageBitmap()`→5×5缩略图获取 25 个像素。它以编码 RGB 的加权平均和 0.5 阈值选黑/白文字，并用 1000ms 动画改变字色；同时调整模糊、亮度、材质对比度与饱和度。这里没有最低文字对比度测试，平均也会抹去同一标签下的黑白分区。采样的是已经调整的 backdrop，控制量与观测量相互影响，不能直接搬作稳定控制器。

[DrawBackdropModifier.kt](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/DrawBackdropModifier.kt) 清楚规定：先 backdrop，后 surface，再 `drawContent()`，前景不会被透镜扭曲。[ColorFilter.kt](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/effects/ColorFilter.kt) 的 `vibrancy()` 实际只是饱和度 1.5 的 ColorMatrix。

[Android 平台检测](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/androidMain/kotlin/com/kyant/backdrop/Platform.kt) 将 RenderEffect 限于 Android 12+、RuntimeShader 限于 Android 13+；[透镜源码](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/effects/Lens.kt) 在不支持时返回。GPU图层转位图可能包含同步/读回成本，5×5输出不意味着前面整层捕获免费；开智应复用已知图片/PDF来源，而非移植常驻捕获循环。

### Haze：材质色调压缩和前景语义分开负责

[GlassStyle.kt](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/haze-glass/src/commonMain/kotlin/dev/chrisbanes/haze/glass/GlassStyle.kt) 为 Regular/Clear 及 light/dark 提供不同白点、对比、照明、折射/模糊设置。[GlassShaders.kt](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/haze-glass/src/commonMain/kotlin/dev/chrisbanes/haze/glass/GlassShaders.kt) 在折射色上做色彩分级、白/黑点混合、对比调整、tint 和 ambient。这处理的是材质背景，而非自动重写前景标签。

[GlassAccessibility.kt](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/haze-glass/src/commonMain/kotlin/dev/chrisbanes/haze/glass/GlassAccessibility.kt) 由主应用提供偏好；[GlassRenderParams.kt](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/haze-glass/src/commonMain/kotlin/dev/chrisbanes/haze/glass/GlassRenderParams.kt) 的 `increaseContrast` 将材质 contrast 至少设为0.16并加强边缘，未读取文字色或计算4.5:1。[示例 GlassButton](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/sample/shared/src/commonMain/kotlin/dev/chrisbanes/haze/sample/components/GlassButton.kt) 将 content 交给调用方。部分平台会省略折射和高级颜色处理；必须验证降级后的可读性。[官方项目指南](https://github.com/chrisbanes/haze/blob/3c1b3b41d57b57035c6025e9694bf5376f6cdaa3/docs/effects/glass.md) 建议从 Balanced 档开始测量实际界面。

## 开智当前实现的优点与真实边界

当前 [glass-contrast.ts](E:/phydog/wugoubot/pdf-copilot/desktop/src/ui/glass-contrast.ts) 已采用线性化 sRGB 的相对亮度和对比度公式，图片区域遵循 cover 几何映射；读写批处理、按事件刷新、保留原值、主题变化清除迟滞并等待材质动画结束，这些比简单按主题或 DOM 背景色判断更稳妥。

需要补足的边界是：

1. `chooseGlassInk()` 只比较谁的比率更高，12%迟滞用于减少跳色；没有达标下限。用现有两个前景色计算，深字亮度为0.0092064、浅字为0.9065313。普通文字目标4.5:1时，浅字要求背景亮度≤0.1625625，深字要求背景亮度≥0.2164287。中间区间两者均不达标；背景亮度约0.1879764时，最佳也只有约4.01944:1。这是依现有常量/公式复算的结果，不是 Apple 阈值。
2. `photoColor()` 对64×64底板缩图区域取 RGB 平均；平均 RGB 的亮度也不等于区域最低字下对比度。细纹、黑白切块、局部阴影会被平均掉。框内的大量空白也会影响决定。
3. 材质合成只读取祖先 `backgroundColor` 和文件夹 SVG fill，未计算背景渐变 sheen、实际 backdrop blur/saturate 或可能的折射。当前没有强折射，仍应先准确处理已有层。
4. [liquid-glass.css](E:/phydog/wugoubot/pdf-copilot/desktop/src/styles/liquid-glass.css) 的 panel 高光 `::after` 使用 z-index:5，可能覆盖部分字形；亮度决策没有计算这个前景上的光照叠层。用户悬停时这种变化尤其容易遗漏。
5. 只在上传底板图片存在有效 grid 时启用取样；默认纹理、设置/确认弹窗和 PDF 内容排除。茶色弹窗有更高不透明度和自身文字色，是否足够仍要单独测。它们不是当前自适应算法覆盖范围。
6. 当前把 `--ink`、`--control-ink`、`--secondary` 和 `--muted` 统一到同色，能避免弱文字丢失，但同时削弱语义层次。语义变量与选中状态要保持分工：选中改变底色灰度，不擅自反转文字。

这些判断来自对当前源码的只读检查；用户既往的主题恢复问题已有专项处理，不能把以上结构边界描述成那个旧 bug 尚未修复。

## 建议的后续实验路线

以下是为优化准备的候选方案，尚未实现或验证。优先级是文字可读性、行为稳定、轻量化，然后才是更强光学效果。

**实验A：建立最终字下背景模型。** 已知上传图片继续仅解码一次；可增加到128×128或按风险局部采样，缓存线性亮度/分布而非每次读取大图。默认纹理可预生成缩图并与主题底色合成。仅在确实覆盖 PDF 的组件，使用当前可见且已渲染的 PDF canvas 建立局部缓存；排除文字层和玻璃自身，以免反馈。缓存键包含文档、页、canvas修订、PDF显示滤镜、透明度/主题和几何位置。图片/黑色滤镜必须按实际显示顺序合成。

Web CSS 无通用 API 直接读取任意最终 backdrop-filter 输出。因此上述模型只能是估计；先处理明确的底色、渐变、叠层、模糊和饱和，再以测试时的真实截图校准。不要把 `getComputedStyle()` 当作最终像素，不全局截屏轮询，不为每个组件常驻 GPU→CPU 读回，不触发新的 PDF 页面渲染。

**实验B：按字下区域检查多个点。** 为标签、数值、图标、帮助文字划分明确区域，以文字矩形/行矩形而非整块侧栏作为输入；每区保留小网格亮度分布。计算每个候选墨色在各样本上的比率，用低分位筛选并记录最低值。分位只用于抵抗采样噪声/排序，不能替代全部关键字区最低要求。黑白同时存在且黑白字均无法达标时进入兜底，不把平均合格写成整个控件合格。

**实验C：语义文字层与带门槛迟滞。** 同一控件的标签、图标和快捷键属于一组，统一选择墨色极性；正文及代码仍走内容主题。常规文字以4.5:1为实验目标，大文字/非文字控件按适用标准单独测。保留旧色仅限它仍达到门槛；跌破门槛立即重新决策。两个候选均达标时才施加收益阈值和稳定时间，主题/内容/页面主动切换应清除旧迟滞。

辅助文字可以调整字重、间距或层级，不能仅降低 opacity 把本已紧张的对比度进一步压低。不要用逐字黑白跳变来拼出混合背景的可读性。同一组件选中/悬停时遵守此前约定，墨色极性稳定，状态由底色灰度和明确的焦点提示表达。

**实验D：字色优先、材质有限兜底。** 先试更接近纯黑/纯白的可读前景、适度字重、极薄中性轮廓/阴影，并在高光层预留文字保护区。若任意字色都不足，必须承认字体颜色补偿本身不足：只在文字保护区加入很弱的中性局部遮罩，或令该控件/弹窗采用 Regular/毛玻璃保底；不要恢复全局大块底色补偿。阴影不能视为自动满足 WCAG，仍以合成前景色与紧邻背景测量，并单独做真实字形视觉检查。

同时测量字色变换整个过程。黑字渐变到白字必经中灰，背景同步变化也不保证中途合格；高风险状态可以离散换极性并只让材质做短动画，或采用有安全背景的文字层过渡。当前开智只需先做离屏实验，不立即更改运行中的UI。

**实验E：固定极端背景矩阵与轻量预算。** 至少包含纯白/纯黑论文、反色 PDF、扫描噪声、彩色封面、黑白半分底板、棋盘与细条纹、中灰/渐变、饱和红蓝底板；叠加透明度0/0.5/1、浅深主题来回切换、侧栏开合、文档标签切换、悬停、焦点、100%–200%缩放与125%–200%DPI。记录关键字区最差/低分位比率、低于门槛持续时间、墨色切换次数和CPU/GPU时间。

目标预算应由实际设备测量：事件驱动、共享队列、有界局部取样、过渡结束补一次校准；静止页面没有轮询，隐藏标签/面板不采样。分别比对现有方案、纯墨色升级、多点决策、局部保护层，再决定哪项值得纳入0.2.1。无障碍高对比/降低透明度继续使用更明确的实底和系统颜色。

## 最适合借鉴的组合

采用 rdev/Kyant0 的“材质处理与清晰前景分层”，Haze 的“按用途选材质、保留图层、明确降级”，Meapri 的“共享事件取样与有迟滞决策”；但亮度计算、候选色下限、最终像素验证及跨背景兜底由开智自己实现。直接替换为任意上述库都不会自动解决 PDF、任意上传底板和文字对比度问题。
