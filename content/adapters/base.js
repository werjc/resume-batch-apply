/**
 * 站点适配器基类
 * 定义统一的适配器接口，每个招聘网站实现自己的适配器
 *
 * 每个适配器需实现：
 *   - name: 网站名称
 *   - domain: 域名匹配规则
 *   - parseSearchResults(): 解析搜索页面的岗位列表
 *   - applyToPosition(element): 对单个岗位执行投递
 *   - checkLoginStatus(): 检查登录状态
 *   - getNextPageUrl(): 获取下一页URL（可选）
 */

class BaseAdapter {
  constructor() {
    this.name = '未命名';
    this.domain = '';
  }

  /**
   * 检查当前页面是否为搜索结果页
   * @returns {boolean}
   */
  isSearchPage() {
    return false;
  }

  /**
   * 解析搜索页面，提取岗位列表
   * @returns {Array<{id: string, title: string, company: string, date: string, companyType: string, jobType: string, salary: string, location: string, elementSelector: string}>}
   */
  parseSearchResults() {
    return [];
  }

  /**
   * 对单个岗位执行投递操作
   * 点击投递按钮、确认弹窗等
   * @param {string} jobId - 岗位ID（对应 parseSearchResults 返回的 id）
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async applyToPosition(element) {
    return { success: false, message: '未实现' };
  }

  /**
   * 检查用户登录状态
   * @returns {{loggedIn: boolean, username: string}}
   */
  checkLoginStatus() {
    return { loggedIn: false, username: '' };
  }

  /**
   * 获取当前页面的岗位元素列表（DOM元素）
   * 子类覆写此方法提供站点专用选择器
   * @returns {Array<Element>}
   */
  getJobElements() {
    return [];
  }

  /**
   * 从岗位 DOM 元素中提取信息
   * @param {Element} element
   * @returns {Object}
   */
  extractJobInfo(element) {
    return {};
  }

  /**
   * 是否有下一页
   * @returns {boolean}
   */
  hasNextPage() {
    return false;
  }

  /**
   * 获取下一页 URL
   * @returns {string|null}
   */
  getNextPageUrl() {
    return null;
  }

  // ========== 通用字段提取（基于DOM结构，不依赖关键词） ==========

  /**
   * 通用岗位标题提取——基于DOM结构而非class名关键词
   *
   * 策略（按优先级）：
   *   1. h1~h6 标题标签
   *   2. font-weight: bold / font-size 最大的元素
   *   3. 第一个非导航 a 标签
   *   4. 最长的一段文本
   *
   * 这保证了无论网站用什么class名，只要能渲染出标题文字，就能抓到。
   *
   * @param {Element} card 岗位卡片元素
   * @returns {string}
   */
  _extractJobTitle(card) {
    // 策略1：标题标签 h1~h6
    for (let i = 1; i <= 6; i++) {
      const h = card.querySelector(`h${i}`);
      if (h) {
        const text = h.textContent.trim();
        if (text.length >= 2 && text.length <= 120 && !this._looksLikeCompanyName(text)) return text;
      }
    }

    // 策略2：视觉评分——但排除公司名
    const allTextEls = Array.from(card.querySelectorAll('a, span, div, p, strong, b, em, h1, h2, h3, h4, h5, h6'));
    let bestEl = null;
    let bestScore = -999;

    for (const el of allTextEls) {
      const text = el.textContent.trim();
      if (text.length < 2 || text.length > 120) continue;
      if (/^[\d\s.,:;，。；：、%+\-xX×]+$/.test(text)) continue;
      if (/^(https?:\/\/|www\.)/i.test(text)) continue;

      const style = window.getComputedStyle(el);
      const weight = parseInt(style.fontWeight) || 400;
      const size = parseFloat(style.fontSize) || 14;
      const tag = el.tagName;
      const href = (el.getAttribute('href') || '').toLowerCase();

      let score = size * 2 + (weight >= 600 ? 20 : 0);

      // 链接加分——但公司链接扣分
      if (tag === 'A') {
        if (/\/job\/|detail|position|recruit/i.test(href)) score += 15;  // 岗位详情链接
        else if (/\/company\/|employer|enterprise/i.test(href)) score -= 30; // 公司链接 → 不是标题
        else score += 5;
      }

      // 标题标签加分
      if (/^H[1-6]$/.test(tag)) score += 25;

      // 长度惩罚
      if (text.length > 80) score -= 20;
      if (text.length < 3) score -= 10;

      // 标题特征加分
      if (/[【\[（(]/.test(text)) score += 8;
      if (/\d+[kKwW万]/.test(text)) score += 5;
      if (/元\/|元$|万\/|万$|K\/|k$/i.test(text)) score -= 15;

      // === 关键：公司名特征 → 大幅扣分 ===
      if (this._looksLikeCompanyName(text)) score -= 60;

      // 城市名开头或纯地址 → 扣分
      if (/^(北京|上海|广州|深圳|杭州|成都|武汉|南京)/.test(text) && text.length < 15) score -= 10;

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl) return bestEl.textContent.trim();

    // 策略3：第一个非公司名的链接
    const links = Array.from(card.querySelectorAll('a[href]'));
    for (const link of links) {
      const text = link.textContent.trim();
      const href = link.href.toLowerCase();
      if (text.length >= 2 && text.length <= 120 &&
          !href.startsWith('javascript') && !href.startsWith('#') &&
          !this._looksLikeCompanyName(text) &&
          !/\/company\/|employer|enterprise/i.test(href)) {
        return text;
      }
    }

    // 策略4：排除公司名的最长文本
    const texts = this._getAllTextsInElement(card);
    const candidates = texts.filter(t => {
      if (t.length < 3 || t.length > 120) return false;
      if (/^[\d\s.,:;，。；：、%+\-]+$/.test(t)) return false;
      if (/^\d+[kKwW万]/.test(t) || /元\/|元$|万\/|万$/.test(t)) return false;
      if (this._looksLikeCompanyName(t)) return false;
      return true;
    });
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aS = a.length >= 4 && a.length <= 50 ? 100 : 0;
        const bS = b.length >= 4 && b.length <= 50 ? 100 : 0;
        return bS - aS || b.length - a.length;
      });
      return candidates[0];
    }

    return '未知岗位';
  }

  /** 一次提取标题+公司名，带交叉校验 */
  _extractBoth(card) {
    let title = this._extractJobTitle(card);
    const company = this._extractCompanyName(card);
    // 交叉校验：标题和公司名相同 → 标题提取失败，排除公司名后重试
    if (title === company && company !== '未知公司' && title !== '未知岗位') {
      title = this._extractJobTitleFallback(card, company);
    }
    return { title, company };
  }

  /** 标题提取兜底——已知公司名，排除它后再找 */
  _extractJobTitleFallback(card, excludeText) {
    const links = Array.from(card.querySelectorAll('a[href]'));
    for (const link of links) {
      const text = link.textContent.trim();
      const href = (link.href || '').toLowerCase();
      if (text.length >= 2 && text.length <= 120 && text !== excludeText &&
          !/\/company\/|employer|enterprise/i.test(href) &&
          !this._looksLikeCompanyName(text)) return text;
    }
    const texts = this._getAllTextsInElement(card);
    for (const t of texts) {
      if (t.length >= 3 && t.length <= 120 && t !== excludeText && !this._looksLikeCompanyName(t)) return t;
    }
    return excludeText; // 实在找不到，返回原标题（即使=公司名）
  }

  /** 判断文本是否像公司名 */
  _looksLikeCompanyName(text) {
    return /有限(?:责任)?公司|股份有限|集团|公司$|有限责任|有限公司|科技有限|技术有限/.test(text) ||
           /^(中国|国家|中央|北京|上海|广州|深圳)(?:市)?[一-龥]{2,12}(?:有限|股份|集团|科技|银行|保险|证券|基金|信托|投资|控股)/.test(text);
  }

  // ========== 通用卡片探测器（万能兜底） ==========

  /**
   * 从任意 document 中探测岗位卡片——先试专用选择器，再试通用启发式
   * @param {Document} doc
   * @returns {Array<Element>}
   */
  _getAllPossibleCards(doc) {
    // 1. 先试子类提供的专用选择器（结果直接信任，不校验内容）
    const fromAdapter = this.getJobElements();
    if (fromAdapter.length > 0) return fromAdapter;

    // 2. 全局通用选择器——覆盖面极广（选择器命中即信任，跳过内容校验）
    const universalSelectors = [
      // li 型
      'li[class*="job"]', 'li[class*="item"]', 'li[class*="card"]',
      'li[class*="list"]', 'li[class*="position"]', 'li[class*="result"]',
      // div 型
      'div[class*="job-card"]', 'div[class*="jobCard"]',
      'div[class*="job-item"]', 'div[class*="jobItem"]',
      'div[class*="job-list"] > div', 'div[class*="joblist"] > div',
      'div[class*="position-item"]', 'div[class*="positionItem"]',
      'div[class*="card-item"]', 'div[class*="cardItem"]',
      'div[class*="list-item"]', 'div[class*="listItem"]',
      'div[class*="result-item"]', 'div[class*="resultItem"]',
      'div[class*="search-item"]', 'div[class*="searchItem"]',
      'div[class*="recommend"] > div',
      'div[class*="recruit"]',
      // 通用包含匹配
      '[class*="job-card"]', '[class*="job-item"]',
      '[class*="position-card"]', '[class*="position-item"]',
      '[class*="recruit-item"]', '[class*="intern-item"]',
      // class 中包含 list/result 的容器下的直接子元素
      '[class*="list-box"] > *', '[class*="listBox"] > *',
      '[class*="list-wrap"] > *', '[class*="listWrap"] > *',
      '[class*="result-list"] > *', '[class*="resultList"] > *',
      '[class*="search-list"] > *', '[class*="search-result"] > *',
      '[class*="content-box"] > [class*="item"]',
      '.search-result > *', '.job-search > *', '.search-list > *',
      // 表格行
      'tr[class*="job"]', 'tr[class*="item"]',
      // 任意包含 item/card 类的元素（在合理容器内）
      'ul > li[class]', 'ol > li[class]',
      // --- 实习专用 ---
      '[class*="intern"] > li', '[class*="intern"] > div[class]',
      '[class*="intern-list"] > li', '[class*="intern-list"] > div',
      '[class*="internList"] > li', '[class*="internList"] > div',
      '[class*="intern-card"]', '[class*="intern-item"]',
      '[class*="internship"] > li', '[class*="internship"] > div[class]',
      // --- 校招/应届 ---
      '[class*="campus"] > li', '[class*="campus"] > div[class]',
      '[class*="graduate"] > li', '[class*="graduate"] > div[class]',
      '[class*="school"] > li', '[class*="school"] > div[class]',
      // --- position 变体 ---
      '[class*="position"] > li', '[class*="position"] > div[class]',
      '[class*="position-list"] > li', '[class*="position-list"] > div',
      '[class*="positionList"] > li', '[class*="positionList"] > div',
      '[class*="position-card"]', '[class*="position-item"]',
      // --- recruit 变体 ---
      '[class*="recruit"] > li', '[class*="recruit"] > div[class]',
      '[class*="recruit-list"] > li', '[class*="recruit-list"] > div',
      '[class*="recruit-card"]', '[class*="recruit-item"]',
    ];

    for (const sel of universalSelectors) {
      try {
        const elements = doc.querySelectorAll(sel);
        // 选择器命中 ≥3 个元素 → 直接信任，不做内容关键词校验
        if (elements.length >= 3) {
          // 只做最基本的过滤：排除空元素
          const valid = Array.from(elements).filter(el => el.textContent.trim().length >= 10);
          if (valid.length >= 3) return valid;
        }
      } catch (e) { /* skip */ }
    }

    // 3. 终极兜底：找兄弟重复结构（只有这里做内容校验，但校验也只用排除法）
    return this._findRepeatingSiblings(doc);
  }

  /**
   * 判断一个元素是否明显"不是"岗位卡片（黑名单思路）
   * 只在此兜底阶段使用：排除明确是噪音的元素，其余全部保留
   * @param {Element} el
   * @returns {boolean}
   */
  _looksLikeJobCard(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (el.className || '').toLowerCase();
    const text = el.textContent.trim();

    // === 排除明确的非内容元素 ===
    // 标签级
    if (/^(script|style|noscript|template|link|meta|br|hr)$/.test(tag)) return false;
    // 导航/页脚/侧边栏
    if (/^(footer|header|nav)$/.test(tag)) return false;
    if (/\b(footer|header|nav|sidebar|menu|banner|breadcrumb|pagination|tab-bar|toolbar|popup|modal|overlay|mask|toast|notice|alert)\b/.test(cls)) return false;
    // 翻页器
    if (/\b(pagination|pager|page-nav|page-bar|paging)\b/.test(cls)) return false;
    // 搜索框/筛选栏
    if (/\b(search-bar|search-box|search-form|filter-bar|filter-box|filter-panel|sort-bar)\b/.test(cls)) return false;
    // 广告
    if (/\b(ad|advert|ads|banner-ad|sponsor|promotion)\b/.test(cls)) return false;
    // 推荐/热门/相关阅读（非搜索结果）
    if (/\b(hot-list|recommend|related|trending|popular|guess-like|hot-search)\b/.test(cls)) return false;

    // === 文本量 ===
    // 太短：基本是空壳或图标
    if (text.length < 10) return false;
    // 太长：可能是页面内容区本身
    if (text.length > 8000) return false;

    // === 排除纯数字/符号 ===
    if (/^[\d\s.,:;，。；：、·\-—|/\\#@!$%^&*()（）\[\]【】<>{}]+$/.test(text)) return false;

    // 其余一律保留
    return true;
  }

  /**
   * 终极兜底：找出 DOM 中重复出现的兄弟元素组
   * @param {Document} doc
   * @returns {Array<Element>}
   */
  _findRepeatingSiblings(doc) {
    const candidates = [];

    // 遍历所有可能包含列表的父容器
    const containers = doc.querySelectorAll('ul, ol, [class*="list"], [class*="List"], [class*="wrap"], [class*="Wrap"], [class*="container"], [class*="box"], [class*="content"], main, section, .result');

    for (const container of containers) {
      const children = Array.from(container.children).filter(c =>
        c.tagName === 'LI' || c.tagName === 'DIV' || c.tagName === 'TR' || c.tagName === 'ARTICLE'
      );

      if (children.length < 3) continue;

      // 检查是否有多于2个结构相似的子元素
      const similarGroups = new Map();
      for (const child of children) {
        const sig = child.tagName + '|' + (child.className || '').replace(/[\d]+/g, 'N').replace(/active|selected|hover|focus|current|first|last/gi, '');
        if (!similarGroups.has(sig)) similarGroups.set(sig, []);
        similarGroups.get(sig).push(child);
      }

      // 找最大的相似组
      for (const [sig, group] of similarGroups) {
        if (group.length >= 5) {
          const valid = group.filter(el => this._looksLikeJobCard(el));
          if (valid.length >= group.length * 0.6) { // 60%以上像岗位卡片
            candidates.push({ group: valid, count: valid.length });
          }
        }
      }
    }

    // 返回数量最多的组
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.count - a.count);
      return candidates[0].group;
    }

    return [];
  }

  // ========== 多页爬取支持 ==========

  /**
   * 通过 fetch 获取指定 URL 的 HTML，解析出岗位列表
   * @param {string} url
   * @returns {Promise<Array<Object>>}
   */
  async _fetchAndParsePage(url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, { credentials: 'include', signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) return [];
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 用通用探测器找到卡片
      const cards = this._getAllPossibleCards(doc);
      if (cards.length === 0) return [];

      return cards.map(el => {
        const info = this.extractJobInfo(el);
        // 确保 id 是纯数据（不带 DOM 引用）
        delete info.element;
        return info;
      });
    } catch (e) {
      console.warn('[BaseAdapter] fetch 页面失败:', url, e.message);
      return [];
    }
  }

  /**
   * 智能获取所有页面的 URL
   * 优先用适配器的 getNextPageUrl，否则猜常见分页模式
   * @param {string} baseUrl 当前页 URL
   * @param {number} maxPages 最多页数
   * @returns {string[]}
   */
  _generatePageUrls(baseUrl, maxPages) {
    const urls = [baseUrl];

    // 先试适配器提供的方法
    if (typeof this.getNextPageUrl === 'function') {
      let currentUrl = baseUrl;
      for (let i = 1; i < maxPages; i++) {
        const nextUrl = this.getNextPageUrl(currentUrl, i + 1);
        if (!nextUrl || urls.includes(nextUrl)) break;
        urls.push(nextUrl);
        currentUrl = nextUrl;
      }
      if (urls.length > 1) return urls;
    }

    // 猜测分页模式
    const parsed = new URL(baseUrl);

    // 模式1: ?page=N 或 &page=N
    const pageParam = parsed.searchParams.get('page') || parsed.searchParams.get('p') || parsed.searchParams.get('pn') || parsed.searchParams.get('pageNum') || parsed.searchParams.get('pageNo');
    if (pageParam !== null) {
      const basePage = parseInt(pageParam) || 1;
      for (let i = basePage + 1; i <= basePage + maxPages - 1; i++) {
        const u = new URL(baseUrl);
        for (const key of ['page', 'p', 'pn', 'pageNum', 'pageNo']) {
          if (u.searchParams.has(key)) { u.searchParams.set(key, String(i)); break; }
        }
        urls.push(u.toString());
      }
      return urls;
    }

    // 模式2: /list/N 或 /search/N/
    const pathMatch = baseUrl.match(/^(.*\/)(\d+)(\/?)$/);
    if (pathMatch) {
      const basePage = parseInt(pathMatch[2]) || 1;
      for (let i = basePage + 1; i <= basePage + maxPages - 1; i++) {
        urls.push(pathMatch[1] + i + pathMatch[3]);
      }
      return urls;
    }

    // 模式3: start=N (用于 offset 分页)
    const startParam = parsed.searchParams.get('start') || parsed.searchParams.get('offset');
    if (startParam !== null) {
      const step = parseInt(startParam) || 20;
      const baseStart = parseInt(startParam) || 0;
      for (let i = 1; i < maxPages; i++) {
        const u = new URL(baseUrl);
        for (const key of ['start', 'offset']) {
          if (u.searchParams.has(key)) { u.searchParams.set(key, String(baseStart + i * step)); break; }
        }
        urls.push(u.toString());
      }
      return urls;
    }

    return urls;
  }

  /**
   * 多页爬取——URL拼接为主，硬超时保护
   */
  async crawlAllPages(baseUrl, maxPages, onProgress, stopSignal) {
    const allJobs = [];
    const seen = new Set();
    const startTime = Date.now();
    const MAX_TIME = 20000; // 硬超时 20 秒

    // 首页 —— 解析当前 DOM
    const p1 = this._getAllPossibleCards(document);
    for (const el of p1) {
      if (stopSignal && stopSignal.stopped) break;
      const info = this.extractJobInfo(el);
      if (!seen.has(info.id)) { seen.add(info.id); delete info.element; allJobs.push(info); }
    }
    if (onProgress) onProgress(1, maxPages);
    if (stopSignal && stopSignal.stopped) { allJobs.forEach(j => { j.risk = this._assessJobRisk(j); }); return allJobs; }

    // 生成多页 URL
    const urls = this._generatePageUrls(baseUrl, maxPages);
    if (urls.length <= 1) {
      // 没有分页URL → 用DOM找翻页按钮，直接点击
      await this._crawlByClicking(maxPages, allJobs, seen, onProgress, stopSignal, startTime, MAX_TIME);
    } else {
      // 有分页URL → fetch
      const remaining = urls.slice(1);
      for (let i = 0; i < remaining.length && Date.now() - startTime < MAX_TIME; i++) {
        if (stopSignal && stopSignal.stopped) break;
        const jobs = await this._fetchAndParsePage(remaining[i]);
        for (const job of jobs) { if (!seen.has(job.id)) { seen.add(job.id); allJobs.push(job); } }
        if (onProgress) onProgress(i + 2, urls.length);
      }
    }

    allJobs.forEach(j => { j.risk = this._assessJobRisk(j); });
    return allJobs;
  }

  /** 点击翻页 */
  async _crawlByClicking(maxPages, allJobs, seen, onProgress, stopSignal, startTime, MAX_TIME) {
    for (let page = 2; page <= maxPages && Date.now() - startTime < MAX_TIME; page++) {
      if (stopSignal && stopSignal.stopped) break;

      const nextBtn = this._findNextPageButton();
      if (!nextBtn) break;

      nextBtn.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 200));
      nextBtn.click();
      await new Promise(r => setTimeout(r, 1500));

      let newCards = 0;
      for (let r = 0; r < 4; r++) {
        if (stopSignal && stopSignal.stopped || Date.now() - startTime > MAX_TIME) break;
        await new Promise(r => setTimeout(r, 400));
        const cards = this._getAllPossibleCards(document);
        for (const el of cards) {
          if (stopSignal && stopSignal.stopped) break;
          const info = this.extractJobInfo(el);
          if (!seen.has(info.id)) { seen.add(info.id); delete info.element; allJobs.push(info); newCards++; }
        }
        if (newCards > 0) break;
      }
      if (onProgress) onProgress(page, maxPages);
      if (newCards === 0) break;
    }
  }

  _findNextPageButton() {
    const all = document.querySelectorAll('a, button, span[role="button"], li[class*="next"]');
    for (const el of all) {
      if (!el.offsetParent || el.disabled || el.classList.contains('disabled')) continue;
      const t = el.textContent.trim().toLowerCase();
      if (/^[>⟩›»]$/.test(t) || t === '下一页' || t === '下页' || t === 'next') return el;
    }
    return null;
  }

  // ========== 岗位风险分析 ==========

  /**
   * 分析岗位诈骗/虚假风险——基于标题和公司信息
   * @returns {{ level: 'low'|'medium'|'high', score: number, reasons: string[] }}
   */
  _assessJobRisk(job) {
    const title = (job.title || '').toLowerCase();
    const company = (job.company || '').toLowerCase();
    const tags = (job.tags || []).join(' ').toLowerCase();
    const all = title + ' ' + company + ' ' + tags;
    const reasons = [];
    let score = 0;

    // === 高危特征 ===
    if (/日结|日薪/.test(all)) { score += 25; reasons.push('日结/日薪——常见于诈骗兼职'); }
    if (/押金|保证金|培训费|报名费|手续费/.test(all)) { score += 30; reasons.push('提及押金/培训费等——任何要求先交钱的都是骗局'); }
    if (/在家.*高薪|高薪.*在家|远程.*高薪/.test(all)) { score += 20; reasons.push('远程+高薪组合——常见骗局模式'); }
    if (/无需经验.*高薪|高薪.*无需经验|不限学历.*高薪/.test(all)) { score += 20; reasons.push('低门槛+高薪——不符合市场规律'); }
    if (/急聘.*大量|大量.*急聘|高薪.*急聘/.test(all)) { score += 15; reasons.push('高薪急聘——常见于虚假招聘'); }
    if (/月入.*万|月薪.*万|年入.*百万/.test(all) && /实习|兼职|新手|入门/.test(all)) { score += 25; reasons.push('兼职/实习+月入过万——极可能是虚假信息'); }
    if (/网络.*兼职|兼职.*网络|打字.*员|刷单|刷客|点赞.*员/.test(all)) { score += 35; reasons.push('刷单/打字员——经典网络诈骗'); }
    if (/数字货币|虚拟货币|区块链.*兼职|挖矿/.test(all)) { score += 20; reasons.push('数字货币相关——高风险'); }
    if (/代购|代收|转账.*兼职|跑分/.test(all)) { score += 35; reasons.push('代购/跑分——可能涉及洗钱等违法活动'); }

    // === 中危特征 ===
    if (company === '未知公司') { score += 10; reasons.push('公司信息缺失'); }
    if (/创业公司|天使轮|未融资/.test(all)) { score += 5; reasons.push('初创公司——稳定性待确认'); }
    if (title.length < 4 && title.length > 0) { score += 10; reasons.push('岗位名称过于简短模糊'); }
    if (/不限学历/.test(all) && /\d+[kKwW万]/.test(all)) { score += 10; reasons.push('不限学历但薪资较高——需核实'); }

    // === 低危加分项（降低风险） ===
    if (/上市公司|上市企业|a股|港股|美股|央企|国企/.test(all)) { score -= 15; reasons.push('知名企业/上市公司'); }
    if (/中国500|世界500|行业龙头|独角兽/.test(all)) { score -= 10; }

    let level = 'low';
    if (score >= 25) level = 'high';
    else if (score >= 12) level = 'medium';

    return { level, score: Math.max(0, score), reasons };
  }

  /**
   * 等待投递结果（有些网站投递后有弹窗提示）
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async waitForResult() {
    return { success: true, message: '投递完成' };
  }

  /**
   * 检测是否有验证码弹窗
   * @returns {boolean}
   */
  hasCaptcha() {
    return false;
  }

  /**
   * 通用公司名提取 - 通过大量候选选择器 + 文本模式匹配
   * @param {Element} element 岗位卡片元素
   * @returns {string}
   */
  _extractCompanyName(element) {
    // 第一层：丰富的 CSS 选择器（按优先级排列）
    const selectors = [
      // -- data 属性 --
      '[data-company]', '[data-companyname]', '[data-company-name]',
      '[data-employer]', '[data-recruiter]',
      // -- class 直接匹配 --
      '.company-name', '.companyName', '.company_text', '.company-text',
      '.company__name', '.cname', '.company-name-box', '.company-name-text',
      '.com-name', '.comName', '.enterprise-name',
      // -- class 包含匹配 --
      '[class*="company-name"]', '[class*="companyName"]',
      '[class*="company_text"]', '[class*="company-text"]',
      '[class*="com-name"]', '[class*="enterprise-name"]',
      // -- 嵌套结构 --
      '.company-info .name', '.company-info .title',
      '.company-info .company', '.company .name',
      '.com-info .com-name', '.com-info .name',
      '.company-info-box .name', '.company-detail .name',
      // -- BOSS直聘 --
      '.company-text .name', '.company-info .company-name',
      '.job-card-body .company-name',
      // -- 智联 --
      '.company__name', '.gsmc a', '.gsmc', '.gsmc span',
      '.joblist-box__item .company__name',
      // -- 51job --
      '.cname .t2 a', '.t2 a', '.cname a', '.cname',
      '.j_joblist .cname', '.joblist .cname',
      // -- 猎聘 --
      '.company-name-box .name', '.company-info .com-name',
      '.job-list-box .company-name',
      // -- 国聘 --
      '.enterprise-name', '.recruit-company',
      // -- 实习僧 --
      '.intern-item .company', '.company-name a',
      // -- 校友邦 / 就业平台 --
      '.recruit-item .company', '.position-item .company',
      // -- 链接型 --
      'a[href*="company"]', 'a[href*="com/info"]',
      'a[ka*="company"]', 'a[ka*="brand"]',
      // -- aria / title --
      '[aria-label*="公司"]', '[title*="公司"]'
    ];

    for (const sel of selectors) {
      try {
        const el = element.querySelector(sel);
        const text = el ? el.textContent.trim() : '';
        // 过滤明显不是公司名的文本
        if (text && text.length >= 2 && text.length <= 80 &&
            !/^(详|详情|查看|浏览|点击|立即|\d+人|\d+个|BOSS|HR|招聘官|沟通|聊天|直聊|在线|离线)$/i.test(text) &&
            !/^(登录|注册|首页|搜索|推荐|热门)$/.test(text)) {
          return text;
        }
      } catch (e) { /* skip */ }
    }

    // 第二层：文本节点正则匹配（增强版）
    const allTexts = this._getAllTextsInElement(element);

    // 模式组1：标准公司名后缀（最可靠）
    const suffixPattern = /(?:有限(?:责任)?公司|股份有限(?:公司)?|有限责任|集团公司?|集团|有限公司)/
    const pattern1 = new RegExp(
      '[\\u4e00-\\u9fa5\\w（）()·•\\-]{2,30}' + suffixPattern.source
    );
    for (const text of allTexts) {
      const m = text.match(pattern1);
      if (m) return m[0];
    }

    // 模式组2：带行业关键词的公司名（科技/网络/信息/…）
    const industryWords = '科技|网络|信息|数据|软件|技术|文化|传媒|教育|咨询|医疗|医药|生物|电子|通信|能源|地产|金融|银行|保险|证券|基金|汽车|制造|贸易|物流|建筑|设计|服务|发展|实业|互联|智能|云|数科|金科|健康';
    const pattern2 = new RegExp('[\\u4e00-\\u9fa5\\w（）()·•]{2,20}(?:' + industryWords + ')(?:有限(?:责任)?公司|股份有限(?:公司)?|公司|集团)?');
    for (const text of allTexts) {
      const m = text.match(pattern2);
      if (m) return m[0];
    }

    // 模式组3：短公司名（2-20字，后面紧跟或前面有公司/企业等词）
    const pattern3 = /[公司企业集团][一-龥\w（）()]{1,15}$|^[一-龥\w（）()]{2,15}[公司企业集团]/;
    for (const text of allTexts) {
      const m = text.match(pattern3);
      if (m) return m[0];
    }

    // 第三层：找链接——指向公司页的 a 标签
    const companyLinkPatterns = [/\/company\//, /\/employer\//, /\/enterprise\//, /\/com\//, /companyid/i, /comid/i];
    const allLinks = Array.from(element.querySelectorAll('a[href]'));
    for (const link of allLinks) {
      const href = link.href.toLowerCase();
      const text = link.textContent.trim();
      if (text.length >= 2 && text.length <= 60 &&
          companyLinkPatterns.some(p => p.test(href))) {
        return text;
      }
    }

    // 第四层：启发式——找到文案最像公司名的文本节点
    // 公司名通常：2-30字、不含常见描述词、在卡片靠上位置
    const badWords = /^(详|详情|查看|浏览|点击|已|否|元|万|千|人|年|天|小时|经验|学历|要求|职责|描述|福利|标签|发布|刷新|推荐|急聘|急招|高薪|五险一金)$/;
    const candidates = allTexts.filter(t => {
      return t.length >= 2 && t.length <= 40 &&
             !badWords.test(t) &&
             !/^\d/.test(t) &&
             !/^[A-Z][a-z]+$/.test(t); // 排除纯英文单词
    });

    if (candidates.length > 0) {
      // 优先返回长度适中的（公司名通常是4-20字）
      candidates.sort((a, b) => {
        const aScore = a.length >= 4 && a.length <= 20 ? 1 : 0;
        const bScore = b.length >= 4 && b.length <= 20 ? 1 : 0;
        return bScore - aScore;
      });
      // 排除明显是职位名/地址/薪资的
      for (const c of candidates) {
        if (!/工程师|经理|主管|专员|助理|代表|顾问|专家|总监|负责人|前台|实习生|管培生|元\/|万\/|K\-|省|市|区|路|号|大厦/.test(c)) {
          return c;
        }
      }
      return candidates[0];
    }

    return '未知公司';
  }

  /**
   * 提取公司详情页URL——从岗位卡片中找公司链接
   */
  _extractCompanyUrl(element) {
    const selectors = [
      'a[href*="company"]', 'a[href*="employer"]', 'a[href*="enterprise"]',
      'a[href*="/com/"]', 'a[href*="/org/"]',
      'a[ka*="company"]', 'a[ka*="brand"]', 'a[ka*="employer"]',
      'a[data-company]', 'a[data-employer]',
      '.company-name a', '.company__name a', '.cname a',
      '.company-info a', '.company-text a',
    ];
    for (const sel of selectors) {
      try {
        const link = element.querySelector(sel);
        if (link && link.href && !link.href.startsWith('javascript')) {
          return link.href;
        }
      } catch (e) { /* skip */ }
    }
    // 兜底：找包含"公司"文本的链接
    const allLinks = Array.from(element.querySelectorAll('a[href]'));
    for (const link of allLinks) {
      if (/公司|企业|employer|company/i.test(link.textContent) && link.href) return link.href;
    }
    return '';
  }

  /**
   * 通用详情页URL提取
   * @param {Element} element 岗位卡片元素
   * @returns {string}
   */
  _extractJobUrl(element) {
    // 策略1：找岗位名称的链接
    const titleSelectors = [
      'a[href*="job"]', 'a[href*="detail"]', 'a[href*="position"]',
      '.job-name a', '.job-title a', '.job-name-box a',
      '[class*="job-name"] a', '[class*="job-title"] a',
      'h2 a', 'h3 a', 'h4 a', '.title a', '.name a',
      '.job-info a', '.jobinfo__name a',
      'a[ka*="job_detail"]', 'a[href*="job_detail"]'
    ];

    for (const sel of titleSelectors) {
      try {
        const link = element.querySelector(sel);
        if (link && link.href && !link.href.startsWith('javascript')) {
          return link.href;
        }
      } catch (e) { /* skip */ }
    }

    // 策略2：取元素内第一个有效链接
    const allLinks = Array.from(element.querySelectorAll('a[href]'));
    for (const link of allLinks) {
      const href = link.href;
      if (href && !href.startsWith('javascript') && !href.startsWith('#') &&
          (href.includes('job') || href.includes('detail') || href.includes('position'))) {
        return href;
      }
    }

    // 策略3：取任意第一个有效链接
    for (const link of allLinks) {
      const href = link.href;
      if (href && !href.startsWith('javascript') && !href.startsWith('#') &&
          !href.includes('company') && link.textContent.trim().length > 1) {
        return href;
      }
    }

    return '';
  }

  /**
   * 获取元素内所有直接文本（去除HTML标签后的纯文本列表）
   * @param {Element} element
   * @returns {string[]}
   */
  _getAllTextsInElement(element) {
    const texts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text && text.length >= 2 && text.length <= 80) {
        texts.push(text);
      }
    }
    return texts;
  }

  /**
   * 增强版岗位类型检测——同时检查标题和标签
   * @param {string} title 岗位标题
   * @param {string[]} tags 标签列表
   * @returns {string} 'intern'|'parttime'|'fulltime'
   */
  _detectJobType(title, tags) {
    const titleText = (title || '').toLowerCase();
    const tagsText = (tags || []).join(' ').toLowerCase();
    const allText = titleText + ' ' + tagsText;

    // === 第1步：从URL上下文推断页面默认类型 ===
    const url = window.location.href.toLowerCase();
    const search = window.location.search.toLowerCase();

    // 检测页面是否有明确的 tab/分类 —— 优先级最高
    const pageHasParttimeTab = /[?&](tab|type|category|jobType)=parttime/i.test(search) || /[?&](tab|type|category)=兼职/i.test(search) || /\/parttime\//i.test(url) || /\/part-time\//i.test(url);
    const pageHasInternTab   = /[?&](tab|type|category|jobType)=intern/i.test(search) || /[?&](tab|type|category)=实习/i.test(search) || /\/intern\//i.test(url) || /\/interns\//i.test(url);
    const pageHasCampusTab   = /[?&](tab|type|category)=campus/i.test(search) || /[?&](tab|type|category)=校招/i.test(search) || /\/campus\//i.test(url);

    // 页面tab明确指示了类型 → 以此为准
    if (pageHasParttimeTab) return 'parttime';
    if (pageHasInternTab)   return 'intern';
    if (pageHasCampusTab)   return 'fulltime'; // 校招是正式岗位

    // === 第2步：卡内关键词检测 ===
    // 兼职
    if (/兼职|part[\s-]?time|小时工|临时工|钟点工|外包|劳务派遣|灵活用工/.test(allText)) return 'parttime';

    // 实习（广泛的实习关键词）
    if (/实习[生岗职位]|实习生|实习期|internship|intern(?!al|et|ational|et\b|al\b)|见习生|管培生|培训生|储备干部|暑期实习|寒假实习|短期实习|实训生/.test(allText)) return 'intern';

    // URL中的实习站
    if (/shixiseng\.com/.test(url)) return 'intern';

    // === 第3步：兜底 ===
    return 'fulltime';
  }

  /**
   * 提取学历要求——从标题和标签中匹配
   * @param {string} title 岗位标题
   * @param {string[]} tags 标签列表
   * @returns {string} 'none'|'associate'|'bachelor'|'master'|'doctor'
   */
  _extractEducation(title, tags) {
    const text = ((title || '') + ' ' + (tags || []).join(' ')).toLowerCase();

    // === 博士（最高优先级） ===
    if (/博士|博士生|博士研究生|博士后|ph\.?d\.?|博士以上|博士及以上/.test(text)) return 'doctor';

    // === 硕士 ===
    if (/硕士|硕士研究生|master|硕士以上|硕士及以上|硕士优先|硕士学历|统招硕士/.test(text)) return 'master';

    // === 本科 ===
    if (/本科|学士|bachelor|大学本科|全日制本科|统招本科|本科以上|本科及以上|本科学历|本科优先|大学以上/.test(text)) return 'bachelor';

    // === 大专/专科 ===
    if (/大专|专科|高职|associate|大专以上|大专及以上|大专学历|统招大专|专科以上|专科及以上|高技/.test(text)) return 'associate';

    // === 高中/中专/中技/初中 → 低于大专，视为不限 ===
    if (/高中|中专|中技|初中|技校|职高|中职/.test(text)) return 'none';

    // === 明确写着"学历不限" ===
    if (/学历不限|不限学历|无学历要求|经验不限.*学历不限|学历.*不限/.test(text)) return 'none';

    // === 模糊模式匹配 ===
    // "统招" 单独出现 → 通常是本科
    if (/统招|全日制/.test(text) && !/大专|专科|高中|中专/.test(text)) return 'bachelor';

    // "211|985|双一流|重点大学" → 隐含本科
    if (/211|985|双一流|重点大学|一本/.test(text)) return 'bachelor';

    // "研究生" 单独出现 → 硕士
    if (/研究生/.test(text) && !/博士|本科/.test(text)) return 'master';

    // === 默认：中国大多数岗位要求本科 ===
    return 'bachelor';
  }

  /**
   * 检测公司类型
   * @param {string} companyName
   * @returns {string} 'listed'|'state'|'foreign'|'private'|'startup'|'unknown'
   */
  /**
   * 公司类型检测——本地标签解析 + 已知公司模式匹配
   * 各适配器可以覆写以添加站点特有逻辑，但最后应 fallback 到这里
   */
  /**
   * 公司类型检测——大规模关键词库 + 默认民营
   *
   * 逻辑：中国绝大多数企业是民营。只有少数是国企/上市/外资/创业。
   * 因此用排除法：先精确识别少数派，剩下的统统归为民营。
   */
  detectCompanyType(companyName, element) {
    const el = element || document;
    const name = (companyName || '').toLowerCase().replace(/\s+/g, '');
    const text = (el.textContent || '').toLowerCase();

    // === 第1层：卡片标签（最高优先级） ===
    const tagEls = el.querySelectorAll('[class*="tag"], [class*="type"], [class*="label"], [class*="badge"], span, em, i');
    for (const tag of tagEls) {
      const t = tag.textContent.trim();
      if (/上市|A股|B股|H股|港股|美股|纳斯达克|纽交所|IPO|已上市|深交所|上交所|北交所|创业板|科创板|新三板/.test(t)) return 'listed';
      if (/国企|央企|国有|国资委|国有独资|全民所有制|事业单位|机关单位|政府机构|党政机关/.test(t)) return 'state';
      if (/外资|外商|外企|合资|中外合资|欧美企|日资|韩资|德资|法资|英资|美资|港澳台资|WFOE/i.test(t)) return 'foreign';
      if (/天使轮|A轮|B轮|C轮|D轮|Pre-A|Pre-IPO|初创|创业|未融资|种子轮/.test(t)) return 'startup';
      if (/民营|私企|私营|民企|个体工商户/.test(t)) return 'private';
    }

    // === 第2层：公司名关键词推断 ===

    // ▸ 央企/国企（中字头、国字头、地方国资）
    if (/^(中国|国家|中央|中华|中核|中航|中船|中兵|中电|中石油|中石化|中海油|中铁|中交|中建|中冶|中粮|中化|中煤|中广核|中车|中航工业|中国航天|中国兵器|中国电子|中国电科|中国信科|中国商飞|中国邮政|中国烟草|中国黄金|中国稀土|中国卫星|中国核工业|中国船舶|中国兵器装备|中国航空发动机)/.test(name)) return 'state';
    if (/^(国投|国电|国网|国药|国机|国开|国新|国盛|国泰|国元|国海|国联|国金|国信|国家电网|南方电网|国家能源|国家电投|国家管网)/.test(name)) return 'state';
    if (/^(华能|华电|大唐|三峡|中核|中广核|中国石油|中国石化|中国海油|中国化工|中国化学|中国建材|中国中车|中国通号|中国中铁|中国铁建|中国交建|中国电建|中国能建|中国建筑|中国中冶|中国有色|中国铝业|中国五矿|中国黄金)/.test(name)) return 'state';
    if (/^(中国移动|中国联通|中国电信|中国广电|中国星网)/.test(name)) return 'state';
    if (/^(中国银行|工商银行|农业银行|建设银行|交通银行|邮储银行|招商银行|中信银行|光大银行|华夏银行|民生银行|兴业银行|浦发银行|平安银行|北京银行|上海银行|江苏银行|南京银行|宁波银行)/.test(name)) return 'state';
    if (/^(中国人寿|中国人保|中国太保|中国太平|中国信保|中国再保|新华保险|泰康保险|阳光保险)/.test(name)) return 'state';
    if (/^(中信证券|中信建投|中金|华泰证券|国泰君安|海通证券|申万宏源|银河证券|招商证券|广发证券|光大证券|安信证券)/.test(name)) return 'state';
    if (/^([一-龥]{2,4})(市|省|区)(人民政府|国资委|国有|城市投资|建设投资|交通投资|水务|燃气|热力|地铁|公交|城建|城投|金控|国控|发投|水投|交投|旅投)/.test(name)) return 'state';
    if (/大学$|学院$|研究院$|设计院$|研究所$|实验室$|科学院$/.test(name) && !/民办|独立学院/.test(name)) return 'state';

    // ▸ 知名上市公司（互联网/科技/制造/消费/医药/地产）
    if (/^(阿里巴巴|阿里云|淘宝|天猫|蚂蚁|支付宝|腾讯|微信|百度|京东|网易|美团|拼多多|字节跳动|抖音|今日头条|小米|快手|滴滴|哔哩哔哩|携程|贝壳|蔚来|理想|小鹏|比亚迪|宁德时代|中芯国际|海康威视|大疆|华为|中兴|联想|海尔|美的|格力|TCL|海信|创维|长虹|康佳)$/.test(name)) return 'listed';
    if (/^(万科|碧桂园|保利|恒大|融创|华润置地|龙湖|招商蛇口|绿城|金地|新城|旭辉|世茂|阳光城|中南|金茂|雅居乐|远洋|华侨城|越秀|建发|首开|城建发展|金融街)$/.test(name)) return 'listed';
    if (/^(恒瑞医药|迈瑞医疗|药明康德|百济神州|信达生物|翰森制药|中国生物制药|石药集团|复星医药|爱尔眼科|智飞生物|康泰生物|华大基因|金域医学|迪安诊断)$/.test(name)) return 'listed';
    if (/^(中国平安|中国人寿|中国太保|新华保险|中国人保|中信证券|东方财富|同花顺)$/.test(name)) return 'listed';
    if (/^(牧原股份|温氏股份|新希望|海大集团|双汇发展|金龙鱼|伊利|蒙牛|光明乳业|海天味业|中炬高新|安井食品|三全食品|绝味食品)$/.test(name)) return 'listed';
    if (/^(隆基绿能|通威股份|阳光电源|晶澳科技|天合光能|晶科能源|中环股份|福斯特|福莱特|先导智能|汇川技术|国电南瑞|特变电工)$/.test(name)) return 'listed';
    if (/^(中国中免|王府井|首旅|锦江|华住|百胜中国|海底捞|呷哺呷哺|九毛九|瑞幸)$/.test(name)) return 'listed';
    if (/^(顺丰|中通|圆通|韵达|申通|极兔|德邦|京东物流|满帮|货拉拉)$/.test(name)) return 'listed';
    if (/^(中国神华|陕西煤业|兖矿能源|中煤能源|紫金矿业|洛阳钼业|山东黄金|赣锋锂业|天齐锂业|华友钴业|寒锐钴业)$/.test(name)) return 'listed';
    if (/^(三一重工|中联重科|徐工|柳工|山推|厦工|潍柴动力|玉柴|云内动力|全柴动力)$/.test(name)) return 'listed';
    if (/^(中国软件|中国长城|太极股份|浪潮信息|中科曙光|紫光股份|深信服|奇安信|启明星辰|绿盟科技|天融信|安恒信息)$/.test(name)) return 'listed';
    if (/^(美的集团|格力电器|海尔智家|老板电器|苏泊尔|九阳|小熊电器|新宝股份|科沃斯|石头科技|追觅)$/.test(name)) return 'listed';

    // ▸ 外资企业（欧美日韩知名企业）
    if (/^(微软|microsoft|苹果|apple|谷歌|google|亚马逊|amazon|meta|facebook|特斯拉|tesla|ibm|intel|英特尔|amd|nvidia|英伟达|qualcomm|高通|broadcom|博通|micron|美光|texas instruments|德州仪器|analog devices|亚德诺|cisco|思科|juniper|瞻博|hp|惠普|dell|戴尔|lenovo|联想)$/i.test(name)) return 'foreign';
    if (/^(sap|oracle|甲骨文|salesforce|赛富时|servicenow|workday|adobe|欧特克|autodesk|vmware|威睿|red hat|红帽|splunk|databricks|snowflake|palantir)$/i.test(name)) return 'foreign';
    if (/^(siemens|西门子|bosch|博世|abb|施耐德|schneider|ge|通用电气|honeywell|霍尼韦尔|emerson|艾默生|rockwell|罗克韦尔|danaher|丹纳赫|thermo fisher|赛默飞|agilent|安捷伦)$/i.test(name)) return 'foreign';
    if (/^(sony|索尼|samsung|三星|lg|panasonic|松下|hitachi|日立|toshiba|东芝|fujitsu|富士通|nec|夏普|sharp|mitsubishi|三菱|fujifilm|富士|canon|佳能|nikon|尼康|olympus|奥林巴斯)$/i.test(name)) return 'foreign';
    if (/^(toyota|丰田|honda|本田|nissan|日产|bmw|宝马|mercedes|奔驰|volkswagen|大众|audi|奥迪|porsche|保时捷|ford|福特|gm|通用汽车|tesla|特斯拉|volvo|沃尔沃|jaguar|捷豹|land rover|路虎|lexus|雷克萨斯|subaru|斯巴鲁|mazda|马自达|hyundai|现代|kia|起亚)$/i.test(name)) return 'foreign';
    if (/^(p&g|宝洁|unilever|联合利华|nestle|雀巢|coca.?cola|可口可乐|pepsi|百事|nike|耐克|adidas|阿迪达斯|lvmh|l'oreal|欧莱雅|estee lauder|雅诗兰黛|shiseido|资生堂|luxe|路威酩轩|chanel|香奈儿|hermes|爱马仕|kering|开云|richemont|历峰)$/i.test(name)) return 'foreign';
    if (/^(pfizer|辉瑞|johnson|强生|roche|罗氏|novartis|诺华|bayer|拜耳|merck|默克|默沙东|sanofi|赛诺菲|gsk|葛兰素|astrazeneca|阿斯利康|abbvie|艾伯维|gilead|吉利德|amgen|安进|lilly|礼来|novo nordisk|诺和诺德)$/i.test(name)) return 'foreign';
    if (/^(shell|壳牌|bp|exxon|埃克森|total|道达尔|chevron|雪佛龙|schlumberger|斯伦贝谢|halliburton|哈里伯顿|baker hughes|贝克休斯)$/i.test(name)) return 'foreign';
    if (/^(morgan stanley|摩根|goldman sachs|高盛|jpmorgan|摩根大通|citi|花旗|hsbc|汇丰|standard chartered|渣打|deutsche bank|德意志|ubs|瑞银|credit suisse|瑞信|barclays|巴克莱|bnp paribas|法巴|societe generale|法兴)$/i.test(name)) return 'foreign';
    if (/^(mckinsey|麦肯锡|bain|贝恩|bcg|波士顿咨询|deloitte|德勤|pwc|普华永道|ey|安永|kpmg|毕马威|accenture|埃森哲|infosys|tcs|wipro|cognizant|hcl)$/i.test(name)) return 'foreign';

    // ▸ 创业公司（从公司名无法判断，但标签已覆盖）

    // === 第3层：排除法兜底 → 默认民营 ===
    // 中国注册企业 99%+ 是民营，未匹配到特殊类型的默认为民营
    return 'private';
  }

  /**
   * 从字符串中提取发布日期
   * @param {string} dateStr
   * @returns {Date|null}
   */
  parseDate(dateStr) {
    if (!dateStr) return null;

    // 处理 "发布于X天前" 格式
    const daysAgo = dateStr.match(/(\d+)\s*天前/);
    if (daysAgo) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(daysAgo[1]));
      return d;
    }

    // 处理 "今天" / "昨天"
    if (dateStr.includes('今天') || dateStr.includes('刚刚')) return new Date();
    if (dateStr.includes('昨天')) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    }

    // 处理 "X小时前"
    const hoursAgo = dateStr.match(/(\d+)\s*小时前/);
    if (hoursAgo) {
      const d = new Date();
      d.setHours(d.getHours() - parseInt(hoursAgo[1]));
      return d;
    }

    // 处理标准日期格式 YYYY-MM-DD 或 YYYY/MM/DD
    const match = dateStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (match) {
      return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }

    return null;
  }
}
