# 开发日志（试错与纠正）

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

## 2026-07-09 — v2.5.0 初始审查

8 项 code review 发现（P0×2, P1×3, P2×3），涵盖权限过度宽泛、筛选回归、AI 硬限制、正面信号混淆、废弃 API。
