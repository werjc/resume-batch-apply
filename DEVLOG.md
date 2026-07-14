# 开发日志（试错与纠正）

## 2026-07-14 — v3.6.0 全域批量投递修复

**问题**: v3.4.0 的断点续投只对 BOSS直聘生效。用户测试发现智联等所有网站都是第一个岗位跳转后停止。

**第一次尝试（v3.4.0）**: 依赖每个适配器 return { navigating: true } 来触发断点。
**失败原因**: 其他 7 个适配器根本没写这个字段，executeApply 看不到 navigating 标志，继续循环→失败。

**第二次尝试（回退）**: 逐个修改 7 个适配器加 navigating 返回。
**更优方案（采纳）**: executeApply 层在 applyToPosition 前后各抓一次 URL，**无论适配器返回什么**，只要 URL 变了就 break。

**额外发现**:
- resumePendingApply 内部调用 refreshPanelData 需要 panelEl 存在 → 面板关闭时崩溃
  - 修复: 加 panelEl/panelVisible 检测，必要时自动 createPanel
- 多个适配器的 applyToPosition 只有 1.5s sleep → 某些慢页面跳转可能来不及
  - 修复: sleep 统一 2s

---

## 2026-07-14 — v3.5.0 智联招聘全子站适配

**需求**: 智联招聘实际有 5 个子站（闲才/政企/校园/卓聘/海外），当前适配器只覆盖了主站。

**方案选择**: 不建 5 个独立适配器（维护灾难），扩展现有 zhaopin.js 适配器。manifest 用 `*.zhaopin.com` 通配一次覆盖。

**自检风险**: 子站专用选择器（如 `.campus-job-item`）是基于命名推测，未经真实验证。兜底：每个子站都有通用 + ultimate 选择器链，即使专用选择器不匹配也能降到基类的 `_getAllPossibleCards` 兜底。

---

## 2026-07-12 — v3.4.0 BOSS直聘断点续投

**问题**: BOSS直聘选中多个岗位后点击"立即投递"，只投了第1个就停了。页面跳到了聊天页，其余岗位无法继续。

**根因**: BOSS直聘的"立即沟通"按钮会导航到聊天页面（URL从 `/web/geek/job` 变为 `/web/geek/chat`）。content script 上下文销毁，`applyQueue`、`jobElementMap` 等全部丢失。

**尝试**: 在聊天页通过 DOM 操作发送招呼语然后自动返回。但 BOSS 的聊天页有反爬机制，且 greeting 不能自动发送（需要用户交互）。

**最终方案**: 断点续投——利用 `chrome.storage.local` 在跳转前后桥接状态：
1. 投递前保存 `pendingQueue`（剩余岗位ID列表）+ `pendingSearchUrl`
2. 投递操作导致跳转 → content script 在新页面重载
3. 新页面检测到 pendingQueue → 自动 `window.location.href = pendingSearchUrl`
4. 返回搜索页 → 重新 parseSearchResults 重建 jobElementMap → 从 queue[1] 继续（跳过已完成的 queue[0]）
5. 循环直到 queue 为空

**自检发现的 bug**:
- 初版在 applyToPosition 返回后立即 remove('pendingQueue')，导致跳转后断点丢失 → 改为仅在循环正常结束或 resumePendingApply 接管时清理
- resumePendingApply 未跳过已完成的 queue[0] → 加 queue.slice(1)
- 空队列时未重置 isApplying + UI → 加显式重置

---

## 2026-07-12 — v3.3.0 工程化加固

**目标**: 从"能用的个人工具"向"可维护的项目"过渡。

**错误边界设计**:
- 每个可能崩溃的入口（refreshPanelData、syncNewJobs）包裹 try/catch
- 捕获后写 errorLog + console.error + 用户可见的错误提示（而非白屏）
- 调试日志上限 50 条、每条最多 500 字符，防止撑爆 storage

**死代码清理决策**:
- `scheduler.js`：已验证全部逻辑在 service-worker 内联，安全删除
- `Storage.addHistory`：数据形状（单条记录）与 `addToHistory`（批次记录）不兼容，删除避免误用

**烟雾测试清单**:
- 8 个站点各 2 项基础检查 + 7 项通用检查
- 发版前逐项验证，发现的 bug 记入 DEVLOG

**Chrome Web Store 准备**:
- 隐私政策：声明本扩展不收集不上传数据，所有数据仅存本地
- manifest description 从 24 字扩充为完整功能描述（8网站+AI+匹配+瀑布流+统计）
- 后续：准备应用截图（4张）→ 注册 Chrome 开发者账号 → 提交审核

---

## 2026-07-12 — v3.3.0 工程化加固

---

## 2026-07-12 — v3.2.1 综合审查修复

**审查方式**: 三个并行 Explore Agent 全量审查，覆盖 service-worker/storage/scheduler + content.js + adapters/popup。

**关键修复**:
- popup 初始化崩溃：`btnRefresh` 元素在 v3.0 删除爬取工具栏时被误删，但 JS 引用残留 → `null.addEventListener` 抛 TypeError
- 统计面板 siteName：字段在 `h.siteName`（批次级），代码读的是 `r.siteName`（岗位级，始终 undefined）
- PDF OOM：50MB PDF 的 `split('').map()` 可创建千万级数组 → 改为 for 循环字节转换 + 10MB 硬限制
- 定时投递 15s 卡顿：`waitForTabLoad` 不检查标签页是否已加载 → 预检 `tab.status === 'complete'`
- 全选误选已投：Set 操作绕过 checkbox disabled → 遍历时过滤 `j.applied`

**低优先级遗留**:
- `utils/scheduler.js` 100 行死代码（所有逻辑已内联到 service-worker）— 暂保留不删
- `Storage.addHistory` vs `addToHistory` 数据形状冲突 — 暂不触发，保留观察
- `_getAllPossibleCards` ~50 次 querySelectorAll 性能 — 不影响功能，留待重构

---

## 2026-07-11 — v3.2.0 已投去重 + 跨站简历

**用户需求**: 投过的岗位刷新后不认识、简历在popup写了sidebar看不到。

**已投去重设计**:
- 投递成功时收集所有 `success: true` 的 jobId
- 追加（push）到 `chrome.storage.local` 的 `appliedJobIds` 数组，不覆盖已有记录
- 面板打开/瀑布流同步时加载 appliedJobIds，对每个岗位标记 `applied: true/false`
- `applyHistory`（批次级统计）和 `appliedJobIds`（岗位级去重）各司其职，互不影响

**已投标记 UI**:
- 已投岗位 checkbox 禁用（disabled），防止误选重复投递
- 行整体 opacity 降为 .65，hover 恢复 .85
- 灰色 pill 标签「✓ 已投」

**跨站简历**: 
- 确认 popup 和 sidebar 都用同一个 `aiConfig` key 读写，数据天然共享
- 新增面板打开时 toast 提示"已加载简历 (xxx字)"，让用户感知到数据已恢复

**ID 稳定性讨论**:
- 当前 ID 基于 title+company+url 生成（适配器级）
- 理论上同一岗位再次解析 ID 相同，去重生效
- 极端情况：岗位标题被HR微调会导致 ID 不同 → 后续可加 title 模糊匹配兜底，当前阶段精确匹配已覆盖 90% 场景

---

## 2026-07-11 — v3.1.1 间距修复

**问题**: 用户反馈各 UI 按钮与按钮、按钮与界面边缘挤在一起，缺乏呼吸感。

**纠正**: 统一增大全局间距。popup 卡片 margin 12→16px，按钮 gap 10→14px，actions padding 12→20px。sidebar 同步对齐。

---

## 2026-07-11 — v3.1.0 UI 重设计

**问题**: v3.0 功能完整但界面陈旧，纯白平面缺乏层次。

**纠正**: 引入玻璃态卡片风格——CSS 变量统一管理色彩/间距/阴影，渐变 header，圆角 pill 标记，hover 上浮动效，光泽进度条。

---

## 2026-07-11 — v3.0.1 PDF+筛选修复

**问题 1**: PDF 上传后无法提取文本。

**尝试**: 初始方案用 `String.fromCharCode.apply(null, arr)` 转二进制为字符串再匹配 BT/ET。
**失败原因**: `apply()` 对大数组抛 RangeError；且 PDF 文本流通常是 FlateDecode 压缩的，二进制直接转字符串匹配不到任何模式。
**纠正**: 改用 `TextDecoder('latin1')` + `DecompressionStream('deflate-raw')` 解压流后再提取 Tj/TJ 操作符中的文本。

**问题 2**: 学历筛选标签「大专及以上」与筛选逻辑不匹配。标签暗示「要求大专或更高」，但逻辑是「用户学历 ≥ 岗位要求」。
**纠正**: 标签改为「我的学历：大专」，让用户理解这是填自己的学历。

**问题 3**: 筛选项改动立即触发筛选，用户希望先配置多个条件再统一应用。
**纠正**: change 事件改为只 saveFilters()，新增「应用筛选」按钮才执行 applyFilters()。

---

## 2026-07-11 — v3.0.0 瀑布流重构

**问题 1**: 深度爬取点击后页面卡死。

**根因**: `chrome.runtime.sendMessage({type:'crawlComplete'})` 从 content script 发出，不会回传给 content script 自身的 `onMessage` 监听器。`handleBgMsg` 永远收不到 `crawlComplete`，`freezeUI(false)` 永不执行。
**纠正**: 删除整个爬取系统，换用 MutationObserver 监听 DOM 变化自动发现新岗位。

**问题 2**: 公司类型筛选无效。

**根因**: `detectCompanyType()` 默认返回 `'private'`，仅匹配 ~200 家知名企业，95%+ 公司归为民营。筛选 `'listed'`/`'state'` 几乎为空。
**纠正**: 默认改为 `'unknown'`，筛选时不过滤未知类型。AI 分析后可自动填充正确类型。

**问题 3**: 学历筛选无效。

**根因**: `_extractEducation()` 默认返回 `'bachelor'`。大部分岗位标题无学历关键词，全部归为本科，筛选「大专及以上」时被排除。
**纠正**: 默认改为 `'none'`（学历不限），未检测到的岗位不排除。

**问题 4**: AI 分析超过 10 条后卡在「分析中」。

**根因**: `autoAiAnalyze()` 将全部岗位标记为 `'analyzing'`，但 `runAiAnalysis()` 只发送前 10 条给 AI 并只更新这 10 条的状态。第 11 条及以后永远停留在「分析中」。
**纠正**: 只标记前 10 条为 analyzing，分析完成后其余岗位恢复无 risk 状态。

---

## 2026-07-11 — v2.7.0 新功能

**新增**: AI 简历匹配评分。扩展 `analyzeWithLLM` prompt 加入候选人简历，AI 同时返回 risk + companyType + matchScore。token 上限从 2000→4000。

**新增**: 投递统计仪表盘。popup 新增 tab 切换「岗位列表/投递统计」，从 `applyHistory` 聚合总投递/成功/失败/成功率/站点分布。

**新增**: CSV 导出。Blob URL 下载，BOM 头保证 Excel 正确识别中文。

---

## 2026-07-11 — v2.6.0 质量优化

**P0-1**: `manifest.json` 中 `https://*/*` 过度宽泛，Chrome Web Store 审核拒绝 → 删除，仅保留 8 站点 + 2 API 域名。

**P1-3**: `_assessJobRisk` 高薪正则在 `all`（标题+公司+标签）上匹配，公司名含「万」如万科万达被误报 → 改为仅在 `title` 上匹配。

**P1-4**: AI 硬限制前 10 个岗位无提示 → 岗位>10 时 toast 通知用户。

**P1-5**: 正面信号「知名企业/上市公司」混入 risk reasons 数组 → 新增 `positives` 字段分离正面信号。

**P2-8**: `unescape()` 已废弃 → 8 个适配器替换为 `TextEncoder` 实现的 `_utf8ToBase64()`。

---

## 2026-07-11 — v3.1.0 UI 重设计

**问题**: 界面功能性完整但视觉陈旧——纯白平面、无层次、按钮拥挤。

**尝试**: 全线引入玻璃态卡片风格——CSS 变量统管颜色/间距/阴影，渐变 header，卡片微阴影分离层次。
**关键决策**: 所有 JS 选择器（id、class、data-id）100% 保持不动，仅改 CSS 和少量 HTML wrapper。零功能风险。
**效果**: popup 和 sidebar 视觉语言统一，风险标记改为圆角 pill，进度条加了光泽动画 (shimmer)。

**二次反馈**: 按钮与边缘挤在一起。
**纠正**: margin 12→16px，gap 10→14px，padding 12→20px。全局统一 16px 呼吸边距。

---

## 2026-07-09 — v2.5.0 初始审查

8 项 code review 发现（P0×2, P1×3, P2×3），涵盖权限过度宽泛、筛选回归、AI 硬限制、正面信号混淆、废弃 API。
