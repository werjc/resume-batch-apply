# 一键批量投递简历 — Chrome 浏览器扩展

[![Version](https://img.shields.io/badge/version-3.1.1-blue)](manifest.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

一个 Chrome 浏览器扩展，帮助求职者在多个招聘网站上一键批量投递简历，支持 AI 风险分析、简历匹配评分、条件筛选、瀑布流实时同步、定时投递等功能。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| **一键批量投递** | 勾选多个岗位后一键自动投递，无需逐个点击 |
| **AI 分析模块** | 接入 DeepSeek/OpenAI，分析岗位风险 + 公司类型 + 简历匹配度评分 |
| **瀑布流实时同步** | MutationObserver 监听页面 DOM，网站滚动加载新岗位自动同步到面板 |
| **📄 PDF 简历上传** | 支持上传 PDF 简历自动提取文本，用于 AI 匹配评分 |
| **条件筛选** | 按发布日期、公司类型、岗位类型、学历要求过滤，点击「应用筛选」生效 |
| **岗位风险预警** | 15 条本地规则 + AI 增强分析，高风险/中风险/低风险三色标记 |
| **投递统计仪表盘** | popup 内切换统计 tab，总投递/成功/失败/成功率/站点分布一目了然 |
| **📥 CSV 导出** | 一键导出投递历史为 CSV 文件 |
| **侧边栏驻留** | 筛选和按钮粘性定位，岗位列表中间滚动，折叠不占页面空间 |
| **SPA 路由感知** | 拦截 pushState/replaceState/popstate/hashchange + 面板开启时轮询 |
| **定时投递** | 设定时间自动执行投递任务 |

## 🌐 支持的招聘网站

| 网站 | 域名 | 状态 |
|------|------|------|
| BOSS直聘 | zhipin.com | ✅ |
| 智联招聘 | zhaopin.com | ✅ |
| 前程无忧 | 51job.com | ✅ |
| 猎聘 | liepin.com | ✅ |
| 国聘 | iguopin.com | ✅ |
| 大学生就业服务平台 | ncss.cn | ✅ |
| 实习僧 | shixiseng.com | ✅ |
| 校友邦 | xiaoyoubang.com | ✅ |

## 🛠 技术栈

- **平台**：Chrome Extension (Manifest V3)
- **架构**：Content Script + Service Worker + Popup + 适配器模式
- **核心技术**：
  - JavaScript (ES6+) 无框架依赖
  - 适配器模式 — 8 个网站独立适配器，基类复用心跳
  - MutationObserver 瀑布流 — 实时发现页面新增岗位卡片
  - DOM 解析 + `getComputedStyle` 视觉属性分析
  - SPA 路由拦截（`history.pushState` / `popstate` / 面板开启轮询）
  - `chrome.storage` / `chrome.alarms` / `chrome.notifications`
  - LLM API 集成（OpenAI 兼容格式，DeepSeek/OpenAI/自定义）
  - PDF 文本提取（DecompressionStream + BT/ET 解析）

## 📁 项目结构

```
resume-batch-apply/
├── manifest.json                # Chrome 扩展配置 (Manifest V3)
├── background/
│   └── service-worker.js        # 后台：定时任务、通知、消息路由、LLM API
├── content/
│   ├── content.js               # 内容脚本：侧边栏UI、瀑布流、筛选、投递、AI
│   └── adapters/                # 站点适配器
│       ├── base.js              # 基类：DOM探测、字段提取、风险分析
│       ├── zhipin.js            # BOSS直聘
│       ├── zhaopin.js           # 智联招聘
│       ├── 51job.js             # 前程无忧
│       ├── liepin.js            # 猎聘
│       ├── iguopin.js           # 国聘
│       ├── ncss.js              # 大学生就业服务平台
│       ├── shixiseng.js         # 实习僧
│       └── xiaoyoubang.js       # 校友邦
├── popup/
│   ├── popup.html               # 工具栏弹窗
│   ├── popup.js                 # 弹窗逻辑：筛选、投递、统计、CSV导出
│   └── popup.css                # 弹窗样式（现代玻璃态）
├── utils/
│   ├── storage.js               # chrome.storage 封装 + 常量
│   └── scheduler.js             # 定时任务管理
├── icons/                       # 扩展图标 (16/48/128px)
├── CHANGELOG.md                 # 版本更新日志
└── DEVLOG.md                    # 开发日志（试错与纠正）
```

## 🚀 安装使用

1. 下载本项目或克隆仓库
2. 打开 Chrome → `chrome://extensions/` → 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择本项目文件夹
4. 打开任意支持的招聘网站搜索结果页
5. 点击浏览器工具栏的扩展图标打开 popup，或右侧面板自动出现

## 🤖 AI 分析模块

在侧边栏或 popup 中展开「AI 分析」，配置 API + 粘贴简历后点击分析：

| 配置项 | 说明 |
|--------|------|
| API 提供商 | DeepSeek / OpenAI（兼容 OpenAI API 格式即可） |
| 模型名称 | `deepseek-chat`、`gpt-4o-mini` 等 |
| API Key | 从对应平台获取 |
| 我的简历 | 粘贴文本或上传 PDF（自动提取），用于岗位匹配评分 |

AI 同时完成三项分析：**岗位风险**（诈骗识别） + **公司类型**（上市/国企/外企/民营/创业） + **简历匹配度**（0-100 分）。

## 🏗 设计亮点

### 适配器模式
每个招聘网站独立适配器，基类提供通用 DOM 探测器、字段提取、风险分析。新增网站只需编写一个适配器。

### 通用 DOM 探测器
三级策略：专用选择器 → 55+ 通用选择器 → DOM 结构启发式（自动发现重复兄弟元素组）。

### 瀑布流实时同步
v3.0 用 MutationObserver 替代了 fetch/点击翻页方案。面板开启时监听页面 DOM，600ms 防抖自动发现新增岗位，面板关闭时停止监听。

### 字段提取基于视觉结构
标题提取通过 `getComputedStyle` 分析 `fontSize`/`fontWeight`/标签类型评分，不依赖特定 class 名。

### 公司类型识别
排除法：300+ 关键词识别国企/央企/上市公司/外企，未知标记为 unknown。AI 分析后可自动填充。

## 📄 License

MIT
