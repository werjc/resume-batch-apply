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
      const resp = await fetch(url, { credentials: 'include' });
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
   * 多页爬取——并行 fetch 所有页，汇总岗位
   * @param {string} baseUrl
   * @param {number} maxPages
   * @param {Function} onProgress (page, total)
   * @returns {Promise<Array<Object>>}
   */
  async crawlAllPages(baseUrl, maxPages, onProgress) {
    const urls = this._generatePageUrls(baseUrl, maxPages);
    const allJobs = [];
    const seen = new Set();

    // 首页用当前 DOM 解析
    const page1Cards = this._getAllPossibleCards(document);
    for (const el of page1Cards) {
      const info = this.extractJobInfo(el);
      if (!seen.has(info.id)) {
        seen.add(info.id);
        delete info.element;
        allJobs.push(info);
      }
    }
    if (onProgress) onProgress(1, Math.max(urls.length, maxPages));

    // 如果只生成了1个URL（SPA无分页参数），改用滚动加载
    if (urls.length <= 1) {
      const scrolled = await this._crawlByScrolling(maxPages, allJobs, seen, onProgress);
      return scrolled;
    }

    // 后续页面并行 fetch（最多同时 3 个）
    const remainingUrls = urls.slice(1);
    const batchSize = 3;

    for (let i = 0; i < remainingUrls.length; i += batchSize) {
      const batch = remainingUrls.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(url => this._fetchAndParsePage(url))
      );

      for (const jobs of results) {
        for (const job of jobs) {
          if (!seen.has(job.id)) {
            seen.add(job.id);
            allJobs.push(job);
          }
        }
      }

      if (onProgress) onProgress(Math.min(i + batchSize + 1, urls.length), urls.length);
    }

    // 批量联网解析公司类型
    await this._resolveCompanyTypesBatch(allJobs);

    return allJobs;
  }

  /**
   * SPA滚动爬取——滚动页面触发懒加载，持续收集新卡片
   */
  async _crawlByScrolling(maxPages, allJobs, seen, onProgress) {
    let prevCount = allJobs.length;
    let noNewRounds = 0;

    for (let page = 2; page <= maxPages; page++) {
      // 滚动到底部
      window.scrollTo(0, document.body.scrollHeight);
      // 等待懒加载
      await new Promise(r => setTimeout(r, 1500));

      // 检查是否有新卡片
      let newCards = 0;
      for (let retry = 0; retry < 3; retry++) {
        await new Promise(r => setTimeout(r, 600));
        const cards = this._getAllPossibleCards(document);
        for (const el of cards) {
          const info = this.extractJobInfo(el);
          if (!seen.has(info.id)) {
            seen.add(info.id);
            delete info.element;
            allJobs.push(info);
            newCards++;
          }
        }
        if (newCards > 0) break;
      }

      if (onProgress) onProgress(page, maxPages);
      if (newCards === 0) {
        noNewRounds++;
        if (noNewRounds >= 2) break; // 连续2轮没新数据，停止
      } else {
        noNewRounds = 0;
      }
      prevCount = allJobs.length;
    }

    // 滚回顶部
    window.scrollTo(0, 0);

    // 批量联网解析公司类型
    await this._resolveCompanyTypesBatch(allJobs);

    return allJobs;
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
    // "统招" 单独出现 → 通常是本科（统招本科是中国最常见表述）
    if (/统招|全日制/.test(text) && !/大专|专科|高中|中专/.test(text)) return 'bachelor';

    // "211|985|双一流|重点大学" → 隐含本科
    if (/211|985|双一流|重点大学|一本/.test(text)) return 'bachelor';

    // "研究生" 单独出现 → 硕士
    if (/研究生/.test(text) && !/博士|本科/.test(text)) return 'master';

    // === 默认：未检测到 → 视为不限 ===
    return 'none';
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
  detectCompanyType(companyName, element) {
    const el = element || document;
    const name = (companyName || '').toLowerCase();
    const text = (el.textContent || '').toLowerCase();

    // === 第1层：从卡片中解析公司标签 ===
    const tagEls = el.querySelectorAll('[class*="tag"], [class*="type"], [class*="label"], [class*="badge"], [class*="icon"], span, em, i');
    for (const tag of tagEls) {
      const t = tag.textContent.trim();
      // 上市公司
      if (/上市|A股|B股|H股|港股|美股|纳斯达克|纽交所|IPO|已上市|深交所|上交所|北交所|创业板|科创板|新三板/.test(t)) return 'listed';
      // 国企/央企
      if (/国企|央企|国有|国资委|国有独资|全民所有制|事业单位|机关单位|政府机构/.test(t)) return 'state';
      // 外资
      if (/外资|外商|外企|合资|中外合资|欧美企业|日资|韩资|德资|法资|英资|美资|港澳台/.test(t)) return 'foreign';
      // 民营
      if (/民营|私企|私营|民企|个体工商户/.test(t)) return 'private';
      // 创业
      if (/天使轮|A轮|B轮|C轮|D轮|Pre-A|Pre-IPO|初创|创业|不需要融资|未融资|种子轮/.test(t)) return 'startup';
    }

    // === 第2层：从公司名推断 ===
    // 央企/国企模式
    if (/^(中国|国家|中央|中华|中核|中航|中船|中兵|中电|中石油|中石化|中海油|中铁|中交|中建|中冶|中粮|中化|中航工|中国航天|中国兵器|中国电子|中国电科)/.test(name)) return 'state';
    if (/银行$|保险$|证券$|基金$|信托$|期货$/.test(name) && /中国|国家|中央|华夏|中信|光大|招商|浦发|兴业|民生|平安/.test(name)) return 'state';
    if (/^(北京|上海|广州|深圳|杭州|成都|武汉|南京|天津|重庆|苏州|西安|长沙|青岛|大连|宁波|厦门|济南|合肥|郑州|东莞|佛山)(市)?(人民政府|国资委|国有|城市|地铁|公交|水务|燃气|热力|城建|城投)/.test(name)) return 'state';
    // 大学/研究院/设计院 → 事业单位/国企
    if (/大学$|学院$|研究院$|设计院$|研究所$|实验室$/.test(name) && !/民办/.test(name)) return 'state';

    // 知名上市互联网公司
    const listedCompanies = /^(阿里巴巴|腾讯|百度|京东|网易|美团|拼多多|字节跳动|小米|快手|滴滴|哔哩哔哩|携程|贝壳|蔚来|理想|小鹏|比亚迪|宁德时代|中芯国际|海康威视|大疆|华为|中兴|联想|海尔|美的|格力|TCL|海信|万科|碧桂园|保利|恒大|融创|华润|招商局|中信|平安|中国人寿|太平洋保险|新华保险|工商银行|建设银行|农业银行|中国银行|交通银行)$/;
    if (listedCompanies.test(name)) return 'listed';

    // 知名外企
    const foreignCompanies = /^(微软|苹果|谷歌|亚马逊|Meta|特斯拉|IBM|Intel|AMD|Nvidia|Qualcomm|SAP|Oracle|Siemens|Bosch|Sony|Samsung|LG|Toyota|Honda|BMW|Mercedes|Volkswagen|Audi|Porsche|通用|福特|宝洁|联合利华|雀巢|可口可乐|百事|耐克|阿迪达斯|LVMH|欧莱雅|辉瑞|强生|罗氏|诺华|拜耳|壳牌|BP|埃克森|道达尔|摩根|高盛|花旗|汇丰|渣打)$/;
    if (foreignCompanies.test(name)) return 'foreign';

    // 知名创业/独角兽公司名 → 暂不硬编码，靠标签

    // === 第3层：从公司名后缀推断 ===
    if (/股份有限$/.test(name) || /^[一-龥]{2,4}(股份|控股)$/.test(name)) {
      // 股份公司→大概率民营或上市，但如果前面标签没匹配到就不确定了
      // 不做最终判断，继续往下走
    }

    // === 第4层：联网查询（只在明确请求时使用，避免频繁请求） ===
    // 此层在 _resolveCompanyTypesBatch 中触发

    return 'unknown';
  }

  /**
   * 批量联网查询公司类型——深度爬取后调用
   * 对 unknown 的公司，fetch 其详情页解析类型，带缓存
   */
  async _resolveCompanyTypesBatch(jobs) {
    const cache = this._companyCache || (this._companyCache = new Map());
    const unknownJobs = jobs.filter(j => j.companyType === 'unknown' && j.company !== '未知公司' && j.url);
    if (unknownJobs.length === 0) return jobs;

    // 去重：同一公司只查一次
    const toFetch = [];
    const seen = new Set();
    for (const j of unknownJobs) {
      const key = j.company + '|' + (j.url || '');
      if (seen.has(key) || cache.has(key)) continue;
      seen.add(key);
      toFetch.push(j);
    }

    // 最多查 8 个公司（避免网络开销过大）
    const batch = toFetch.slice(0, 8);
    const results = await Promise.allSettled(
      batch.map(j => this._fetchCompanyTypeFromPage(j.url, j.company))
    );

    for (let i = 0; i < batch.length; i++) {
      const type = results[i].status === 'fulfilled' ? results[i].value : 'unknown';
      const key = batch[i].company + '|' + (batch[i].url || '');
      cache.set(key, type);
    }

    // 应用缓存到所有 job
    for (const j of jobs) {
      if (j.companyType !== 'unknown') continue;
      const key = j.company + '|' + (j.url || '');
      if (cache.has(key)) j.companyType = cache.get(key);
    }

    return jobs;
  }

  /**
   * fetch 公司详情页，提取公司类型
   */
  async _fetchCompanyTypeFromPage(url, companyName) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return 'unknown';

      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bodyText = (doc.body?.textContent || '').toLowerCase();

      // 上市公司
      if (/上市|a股|b股|h股|港股|美股|ipo|证券代码|股票代码|深交所|上交所/.test(bodyText)) return 'listed';
      // 国企
      if (/国有|国企|央企|国资委|国有独资|全民所有|事业单位/.test(bodyText)) return 'state';
      // 外资
      if (/外商|外资|外企|中外合资|独资.*外|wfoe|foreign/i.test(bodyText)) return 'foreign';
      // 民营
      if (/民营|私营|民企/.test(bodyText)) return 'private';
      // 创业
      if (/天使轮|a轮|b轮|pre-a|初创|创业|不需要融资/.test(bodyText)) return 'startup';

      return 'unknown';
    } catch (e) {
      return 'unknown';
    }
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
