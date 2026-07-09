# 一键批量投递简历 — Chrome 浏览器扩展

[![Version](https://img.shields.io/badge/version-1.6.0-blue)](manifest.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

一个 Chrome 浏览器扩展，帮助求职者在多个招聘网站上一键批量投递简历，支持条件筛选、深度爬取、定时投递等功能。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| **一键批量投递** | 勾选多个岗位后一键自动投递，无需逐个点击 |
| **深度爬取** | 自动翻页抓取多页搜索结果，SPA 站点自动切换滚动加载 |
| **条件筛选** | 按发布日期、公司类型、学历要求过滤岗位 |
| **SPA 路由感知** | 检测单页应用路由变化，自动刷新岗位列表 |
| **侧边栏驻留** | 右侧面板展开时不遮挡页面内容，可折叠为竖条 |
| **定时投递** | 设定时间自动执行投递任务 |
| **一键停止** | 投递中途随时中止 |

## 🌐 支持的招聘网站

| 网站 | 状态 |
|------|------|
| BOSS直聘 (zhipin.com) | ✅ 支持 |
| 智联招聘 (zhaopin.com) | ✅ 支持 |
| 前程无忧 (51job.com) | ✅ 支持 |
| 猎聘 (liepin.com) | ✅ 支持 |
| 国聘 (iguopin.com) | ✅ 支持 |
| 大学生就业服务平台 (ncss.cn) | ✅ 支持 |
| 实习僧 (shixiseng.com) | ✅ 支持 |
| 校友邦 (xiaoyoubang.com) | ✅ 支持 |

## 📸 界面预览

- 淡蓝色主题，简洁明了
- 右侧侧边栏布局，推开页面内容显示，不遮挡原页面
- 自适应宽度：小屏 380px，大屏 500px
- 支持折叠为边缘竖条

## 🛠 技术栈

- **平台**：Chrome Extension (Manifest V3)
- **架构**：Content Script + Service Worker + 适配器模式
- **核心技术**：
  - JavaScript (ES6+) 无框架依赖
  - DOM 解析与操作
  - SPA 路由拦截 (`history.pushState` / `popstate` / 轮询)
  - `chrome.storage` / `chrome.alarms` / `chrome.notifications`
  - 适配器模式 (Adapter Pattern) — 每个招聘网站独立适配器
  - `fetch` + `DOMParser` 跨页数据抓取

## 📁 项目结构

```
resume-batch-apply/
├── manifest.json                # Chrome 扩展配置
├── background/
│   └── service-worker.js        # 后台调度：定时任务、通知、消息路由
├── content/
│   ├── content.js               # 内容脚本：面板UI、交互逻辑、投递执行
│   └── adapters/
│       ├── base.js              # 基类：通用DOM探测器、字段提取、公司类型查询
│       ├── zhipin.js            # BOSS直聘适配器
│       ├── zhaopin.js           # 智联招聘适配器
│       ├── 51job.js             # 前程无忧适配器
│       ├── liepin.js            # 猎聘适配器
│       ├── iguopin.js           # 国聘适配器
│       ├── ncss.js              # 大学生就业服务平台适配器
│       ├── shixiseng.js         # 实习僧适配器
│       └── xiaoyoubang.js       # 校友邦适配器
├── utils/
│   ├── storage.js               # chrome.storage 封装
│   └── scheduler.js             # 定时任务管理
└── icons/                       # 扩展图标
```

## 🚀 安装使用

1. 下载本项目或克隆仓库
2. 打开 Chrome 浏览器，地址栏输入 `chrome://extensions/`
3. 打开右上角「开发者模式」开关
4. 点击左上角「加载已解压的扩展程序」
5. 选择本项目文件夹
6. 打开任意支持的招聘网站搜索结果页
7. 点击浏览器工具栏的扩展图标，面板出现在页面右侧

## 🏗 设计亮点

### 适配器模式
每个招聘网站有独立的适配器文件，实现统一接口。新增网站只需编写一个适配器，无需修改核心代码。

### 通用 DOM 探测器
三层策略自动发现岗位卡片：专用选择器 → 50+ 通用选择器 → DOM 结构启发式（找重复兄弟元素组）。不依赖特定 class 名。

### 字段提取基于 DOM 视觉结构
标题提取通过 `getComputedStyle` 分析元素的 `fontSize`/`fontWeight`/标签类型来评分，而非硬编码 class 名。

### 公司类型联网查询
本地无法判断时，自动 `fetch` 公司详情页解析公司类型（上市公司/国企/外企/民营/创业），带内存缓存去重。

## 📄 License

MIT
