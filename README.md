# 一键批量投递简历 — Chrome 浏览器扩展

[![Version](https://img.shields.io/badge/version-2.6.0-blue)](manifest.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

一个 Chrome 浏览器扩展，帮助求职者在多个招聘网站上一键批量投递简历，支持 AI 风险分析、条件筛选、深度爬取、定时投递等功能。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| **一键批量投递** | 勾选多个岗位后一键自动投递，无需逐个点击 |
| **AI 分析模块** | 接入 DeepSeek/OpenAI 等大模型，自动分析岗位风险（诈骗识别）和公司类型 |
| **深度爬取** | 自动翻页抓取多页搜索结果，20 秒硬超时保护，爬取中冻结 UI 防误操作 |
| **条件筛选** | 按发布日期、公司类型（上市公司/国企/外企/民营/创业）、学历要求过滤 |
| **岗位风险预警** | 15 条本地规则 + AI 增强分析，高风险（红色）/ 中风险（黄色）/ 低风险（绿色） |
| **SPA 路由感知** | 拦截 pushState / popstate / hashchange + 800ms 轮询，实时感知页面切换 |
| **侧边栏驻留** | 筛选和按钮粘性定位，岗位列表中间滚动，不遮挡页面内容 |
| **定时投递** | 设定时间自动执行投递任务 |
| **一键停止** | 投递中途随时中止 |

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
- **架构**：Content Script + Service Worker + 适配器模式
- **核心技术**：
  - JavaScript (ES6+) 无框架依赖
  - DOM 解析 + `getComputedStyle` 视觉属性分析
  - SPA 路由拦截（`history.pushState` / `popstate` / 轮询）
  - `chrome.storage` / `chrome.alarms` / `chrome.notifications`
  - 适配器模式 — 8 个网站独立适配器
  - `fetch` + `DOMParser` 跨页数据抓取
  - LLM API 集成（OpenAI 兼容格式，支持 DeepSeek/OpenAI/自定义）

## 📁 项目结构

```
resume-batch-apply/
├── manifest.json                # Chrome 扩展配置 (Manifest V3)
├── background/
│   └── service-worker.js        # 后台：定时任务、通知、消息路由、LLM API 调用
├── content/
│   ├── content.js               # 内容脚本：面板UI、筛选、投递、AI模块
│   └── adapters/                # 站点适配器
│       ├── base.js              # 基类：DOM探测、字段提取、风险分析、爬取引擎
│       ├── zhipin.js            # BOSS直聘
│       ├── zhaopin.js           # 智联招聘
│       ├── 51job.js             # 前程无忧
│       ├── liepin.js            # 猎聘
│       ├── iguopin.js           # 国聘
│       ├── ncss.js              # 大学生就业服务平台
│       ├── shixiseng.js         # 实习僧
│       └── xiaoyoubang.js       # 校友邦
├── utils/
│   ├── storage.js               # chrome.storage 封装
│   └── scheduler.js             # 定时任务管理
└── icons/                       # 扩展图标 (16/48/128px)
```

## 🚀 安装使用

1. 下载本项目或克隆仓库
2. 打开 Chrome → `chrome://extensions/` → 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择本项目文件夹
4. 打开任意支持的招聘网站搜索结果页
5. 点击浏览器工具栏的扩展图标，右侧面板出现

## 🤖 AI 分析模块

在筛选模块下方展开「AI 分析」，配置 API 后点击分析：

| 配置项 | 说明 |
|--------|------|
| API 提供商 | DeepSeek / OpenAI / 自定义（兼容 OpenAI API 格式即可） |
| API 地址 | 自定义时填写完整 endpoint |
| 模型名称 | 如 `deepseek-chat`、`gpt-4o-mini` |
| API Key | 从对应平台获取 |

AI 会同时分析：**岗位风险**（诈骗/虚假识别）和 **公司类型**（解决搜索结果页无公司类型数据的问题）。配置自动保存。

## 🏗 设计亮点

### 适配器模式
每个招聘网站独立适配器，实现统一接口。新增网站只需编写一个适配器文件。

### 通用 DOM 探测器
三级策略：专用选择器 → 55+ 通用选择器 → DOM 结构启发式（自动发现重复兄弟元素组）。

### 字段提取基于视觉结构
标题提取通过 `getComputedStyle` 分析 `fontSize`/`fontWeight`/标签类型评分，不依赖特定 class 名。

### 公司类型识别
排除法：300+ 关键词精准识别国企/央企/上市公司/外企，其余默认民营（中国 99%+ 企业为民营）。

### AI 增强
可选接入 LLM，对岗位风险和公司类型进行深度分析。支持任何 OpenAI 兼容 API。

## 📄 License

MIT
