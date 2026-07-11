# 版本更新日志

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
