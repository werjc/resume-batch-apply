/**
 * BOSS直聘 (zhipin.com) 适配器
 *
 * BOSS直聘的投递机制：
 * - 通过"立即沟通"按钮发起聊天，简历会自动发送给对方
 * - 搜索结果页URL: https://www.zhipin.com/web/geek/job?query=...
 * - 岗位卡片选择器需要根据实际页面验证
 *
 * 注意：BOSS直聘使用 Vue/React 动态渲染，DOM 选择器可能随版本变化
 */

class ZhipinAdapter extends BaseAdapter {
  constructor() {
    super();
    this.name = 'BOSS直聘';
    this.domain = 'zhipin.com';
  }

  isSearchPage() {
    // BOSS直聘所有含岗位列表的页面
    const path = window.location.pathname;
    if (path.includes('/web/geek/job') || path.includes('/web/geek/job-recommend') || path.includes('/c101')) return true;
    // 首页 /web/geek/ 或 /web/geek
    if (path === '/web/geek/' || path === '/web/geek' || path === '/' || path === '/web/geek/index') return true;
    // DOM 检测
    if (document.querySelector('.search-job-result, .job-list-box, .job-card-wrapper, .recommend-job-list')) return true;
    if (document.querySelector('[class*="job-card"], [class*="jobCard"]')) return true;
    return false;
  }

  getJobElements() {
    const selectors = [
      // --- BOSS直聘专用 ---
      '.job-card-wrapper', '.job-card-box',
      '.job-list-box .job-card', '.job-list-box > li',
      '.search-job-result > li', '.search-job-result > div',
      '[class*="job-card-wrapper"]', '[class*="job-card-box"]',
      '[class*="job-card"]:not([class*="list"])',
      '[class*="jobCard"]:not([class*="list"])',
      '.job-list > li', '.job-list > div[class]',
      '.job-list-box > div[class]',
      // --- 首页推荐 ---
      '.recommend-job-list > li', '.recommend-job-list > div[class]',
      '[class*="recommend"] > [class*="job"]',
      '.geek-index > [class*="job"]', '.index-content [class*="job-card"]',
      // --- 通用 ---
      '.search-result > li', '.search-result > div[class]',
      '.result-list > li', '.result-list > div[class]',
      '[class*="result-list"] > li', '[class*="result-list"] > div[class]',
      '[class*="list-box"] > li', '[class*="list-box"] > div[class]',
      '[class*="list-wrap"] > li', '[class*="list-wrap"] > div[class]',
      '[class*="job-list"] > li', '[class*="job-list"] > div[class]',
      '[class*="joblist"] > li', '[class*="joblist"] > div[class]',
      '[class*="position"] > li', '[class*="position"] > div[class]',
      '[class*="intern"] > li', '[class*="intern"] > div[class]',
      // --- 卡片型 ---
      'li[class*="job"]', 'li[class*="item"]', 'li[class*="card"]',
      'div[class*="job-card"]', 'div[class*="job-item"]',
      // --- 终极 ---
      'ul > li[class]', 'ol > li[class]',
    ];
    for (const sel of selectors) {
      try {
        const elements = document.querySelectorAll(sel);
        if (elements.length >= 3) return Array.from(elements);
      } catch (e) { /* skip */ }
    }
    return [];
  }

  extractJobInfo(element) {
    // 岗位名称
    const { title, company } = this._extractBoth(element);

    // 详情页链接
    const url = this._extractJobUrl(element);
    const companyUrl = this._extractCompanyUrl(element);

    // 薪资
    const salaryEl = element.querySelector('.salary, .red, [class*="salary"]');
    const salary = salaryEl ? salaryEl.textContent.trim() : '';

    // 发布日期
    const dateEl = element.querySelector('.job-pub-time, .time, [class*="time"], [class*="date"]');
    const date = dateEl ? dateEl.textContent.trim() : '';

    // 标签 / 岗位要求
    const tags = Array.from(element.querySelectorAll('.tag-item, .job-tag, [class*="tag"], .condition'))
      .map(t => t.textContent.trim())
      .filter(Boolean);

    // 公司类型标签（BOSS直聘可能有：上市公司、已上市、不需要融资等）
    const companyTypeEl = element.querySelector('.company-tag, [class*="company-tag"]');
    const companyType = companyTypeEl ? companyTypeEl.textContent.trim() : '';

    return {
      id: this._generateId(element),
      title,
      company,
      url,
      companyUrl,
      salary,
      location: tags.find(t => !t.includes('经验') && !t.includes('学历')) || '',
      date,
      dateObj: this.parseDate(date),
      companyType: companyType || this.detectCompanyType(company, element),
      jobType: this._detectJobType(title, tags),
      education: this._extractEducation(title, tags),
      tags,
      element
    };
  }

  parseSearchResults() {
    const elements = this.getJobElements();
    return elements.map(el => this.extractJobInfo(el));
  }

  async applyToPosition(element) {
    try {
      // BOSS直聘实操流程：点击卡片→右侧详情→"立即沟通"
      // 第1步：点击岗位卡片，打开右侧详情面板
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this._sleep(400);
      element.click();
      await this._sleep(2000);

      // 第2步：在详情面板（或页面任意位置）找"立即沟通"按钮
      const chatSelectors = [
        '.btn-startchat', '.btn-chat', '.start-chat-btn',
        '[class*="start-chat"]', '[class*="startChat"]',
        '.chat-btn', '.op-btn-startchat',
        'a[ka*="chat"]', 'button[ka*="chat"]',
        '.dialog-btn', '.btn-send', '.op-btn',
      ];
      let chatBtn = null;
      for (const sel of chatSelectors) {
        chatBtn = document.querySelector(sel);
        if (chatBtn && chatBtn.offsetParent !== null) break;
        chatBtn = null;
      }

      // 如果在详情面板找不到，尝试在卡片内找
      if (!chatBtn) {
        chatBtn = element.querySelector('button, [class*="btn"], a[class*="btn"]');
      }

      if (!chatBtn) {
        return { success: false, message: '未找到沟通按钮，请手动操作' };
      }

      // 第3步：点击"立即沟通"
      chatBtn.click();
      await this._sleep(1500);

      // 第4步：处理确认弹窗
      await this.waitForResult();

      // 第5步：关闭详情面板（如果有）
      const closeBtn = document.querySelector('.dialog-close, .modal-close, [class*="close"], .op-btn-close');
      if (closeBtn) closeBtn.click();
      await this._sleep(300);

      return { success: true, message: '已发送沟通' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async waitForResult() {
    await this._sleep(1500);

    // 检测是否有验证码
    if (this.hasCaptcha()) {
      return { success: false, message: '需要验证码，请手动操作' };
    }

    // 检测弹窗确认按钮
    const confirmBtn = document.querySelector('.dialog-ok, .btn-confirm, .dialog-footer .btn-primary, .van-dialog__confirm');
    if (confirmBtn) {
      confirmBtn.click();
      await this._sleep(500);
    }

    return { success: true, message: '已发送沟通（简历已自动发送）' };
  }

  checkLoginStatus() {
    // 检查页面是否有登录状态元素
    const userMenu = document.querySelector('.user-menu, .user-nav, .header-login, [class*="user"]');
    const loginBtn = document.querySelector('.login-btn, .btn-login, [class*="login"]');

    if (loginBtn && loginBtn.textContent.includes('登录')) {
      return { loggedIn: false, username: '' };
    }

    if (userMenu) {
      const nameEl = userMenu.querySelector('.name, .nickname, [class*="name"]');
      return { loggedIn: true, username: nameEl ? nameEl.textContent.trim() : '已登录' };
    }

    // 兜底：检查 cookie/localStorage
    return { loggedIn: !!document.cookie.includes('zp_token'), username: '' };
  }

  hasCaptcha() {
    return document.querySelector('.captcha, .geetest, .verify-code, [class*="captcha"], [class*="verify"]') !== null;
  }

  _generateId(element) {
    // 确定性ID：基于标题+公司名+岗位链接，同元素永远生成相同ID
    const { title, company } = this._extractBoth(element);
    const url = this._extractJobUrl(element);
    const raw = `${title}|${company}|${url}`;
    return 'zp_' + this._utf8ToBase64(raw).slice(0, 40);
  }

  _findElementById(jobId) {
    const elements = this.getJobElements();
    for (const el of elements) {
      if (this._generateId(el) === jobId) return el;
    }
    return null;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 注册到全局
window.__siteAdapter = new ZhipinAdapter();
