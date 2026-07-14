# 版本更新日志

## v3.6.1 (2026-07-14)
**修复** — 岗位解析降级兜底 + 面板重复创建 + 低风险累积bug
- 8个适配器 parseSearchResults 统一降级：getJobElements 空→_getAllPossibleCards 兜底
- createPanel 加旧面板清理（remove旧DOM + 旧style），防止多次调用产生重复面板
- refreshPanelData 开始前暂停瀑布流，防止并发写入 allJobs

## v3.6.0 (2026-07-14)
**修复** — 全域批量投递：8网站统一断点续投
- executeApply 层自动检测 URL 跳转（beforeUrl vs afterUrl），不再依赖适配器单独返回 navigating
- resumePendingApply 面板关闭保护：自动创建面板 + 重启 Observer
- 7 个适配器 applyToPosition 统一模式：记录 URL → 点击 → 等待 2s → 检测跳转 → 返回 navigating
- 修复点击第一个岗位后跳转导致剩余岗位无法投递的核心 bug

## v3.5.0 (2026-07-14)
**功能** — 智联招聘全子站适配（5个新子域名）
- 新增：智联闲才(xiancai)、政企招聘(govjob)、智联校园(xiaoyuan)、智联卓聘(highpin)、智引海外(overseas)
- manifest: host_permissions + content_scripts 改为 `*.zhaopin.com` 通配
- zhaopin.js: _detectSubSite 自动识别子站名 + isSearchPage 各子站路径 + getJobElements ~20个子站专用选择器
- popup: detectSite 精确匹配子站域名

## v3.4.0 (2026-07-12)
**功能** — BOSS直聘断点续投：批量投递支持跨页面跳转
- 每次投递前自动保存剩余队列到 storage（pendingQueue）
- 投递导致页面跳转（如BOSS聊天页）→ 自动返回搜索页 → 继续剩余岗位
- zhipin.js 适配器改进：更全面的"立即沟通"按钮检测 + 跳转后自动返回
- 修复批量投递在第1个岗位后卡住的核心问题

## v3.3.0 (2026-07-12)
**工程化** — 错误边界 + 调试日志 + 死代码清理 + 测试清单 + Chrome商店准备
- 全局错误边界：refreshPanelData/syncNewJobs 异常不再白屏，显示错误提示
- 调试日志：chrome.storage.local 存最近50条错误，AI面板🔧按钮一键复制到剪贴板
- 死代码清理：删除 utils/scheduler.js（100行从未引用）
- 删除 Storage.addHistory（与 service-worker addToHistory 数据形状冲突）
- 新增 TEST_CHECKLIST.md：8站点烟雾测试清单
- 新增 PRIVACY.md：隐私政策（Chrome Web Store 审核必备）
- manifest description 更新为完整功能描述

## v3.2.1 (2026-07-12)
**修复** — 综合审查 19 项修复（关键4项 + 中等7项 + 低优8项）
- popup: 修复 btnRefresh 缺失导致初始化崩溃；统计面板 siteName 读取路径
- popup: AI 分析结果补 ai:true；CSV 导出 h.time 兜底；清除 .crawl-toolbar 死选择器
- content: PDF 加 10MB 大小限制 + 优化字节转换（OOM 防护）
- content: 全选/反选跳过已投岗位 + 竞态保护（面板关闭时不启动 Observer）
- service-worker: waitForTabLoad 已加载标签页不再阻塞 15s + 监听器泄漏修复
- service-worker: hostname 匹配反转修复（taskHost/tabHost endsWith 双向比对）
- base: _extractJobTitleFallback 兜底不再返回公司名；正面信号显示在风险提示中

## v3.2.0 (2026-07-11)
**功能** — 已投岗位去重 + 跨站简历共享
- 新增 `appliedJobIds` 存储层：投递成功自动记录岗位 ID（追加不覆盖，上限 500 条）
- 已投岗位显示「✓ 已投」灰色标记，checkbox 自动禁用，防止重复投递
- 刷新页面/切换网站后记忆保留（storage.local 跨标签页共享）
- 跨站简历存储确认生效：popup写的简历 sidebar 自动加载，反之亦然

## v3.1.1 (2026-07-11)
**修复** — 统一按钮与界面边距
- popup 卡片 margin 12→16px，按钮 gap 10→14px，actions padding 12→20px
- sidebar body padding 12→16px，actions gap 8→12px，header padding 18→20px
**文档** — README + RESUME_GUIDE 同步至 v3.1.1，新增 CHANGELOG + DEVLOG

## v3.1.0 (2026-07-11)
**功能** — UI 全面重设计 & 视觉美化
- 现代轻量玻璃态卡片设计，CSS 变量统一色彩/间距/阴影
- 渐变 header + 卡片微阴影 + hover 上浮动效
- 圆角 pill 形风险/匹配标记，进度条光泽动画
- Tab 滑动指示条，Toast 弹性滑入，Modal 背景模糊

## v3.0.1 (2026-07-11)
**修复** — PDF提取 + 学历标签 + 筛选确定按钮
- PDF 提取重写：DecompressionStream 解压 FlateDecode 流
- 学历标签改为「我的学历：X」匹配筛选逻辑
- 筛选增加「应用筛选」按钮

## v3.0.0 (2026-07-11)
**重构** — 瀑布流模式 + 4项 Bug 修复 + PDF简历
- 删除深度爬取全部代码（fetch/点击翻页/分页URL推断）
- 新增 MutationObserver 瀑布流：滚动自动同步新岗位
- 修复公司类型默认值 `'private'` → `'unknown'`
- 修复学历默认值 `'bachelor'` → `'none'`
- 修复 AI 卡在分析中（只标记前10条）

## v2.7.0 (2026-07-11)
**功能** — AI简历匹配 + 投递统计 + CSV导出 + 质量优化
- AI 简历匹配度评分（侧边栏+popup）
- 投递统计仪表盘（popup tab 切换）
- 投递记录 CSV 导出
- AI 请求 30s AbortController 超时，爬取动态超时

## v2.6.0 (2026-07-11)
**修复** — Code Review 全部 8 项修复
- P0: 移除 https://*/* 宽泛权限，补回学历不限选项
- P1: 高薪正则仅匹配 title，AI 超10条 toast 提示，正面信号分离
- P2: 学历默认值注释，companyUrl 渲染链接，unescape→TextEncoder

## v2.5.0 (2026-07-09)
**功能** — AI自动分析 + 风险筛选 + BOSS首页识别 + UI粘性布局

## v1.6.0
**初始版本** — 一键批量投递简历 Chrome 扩展
