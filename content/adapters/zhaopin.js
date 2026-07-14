/**
 * 智联招聘 (zhaopin.com) 适配器 — 覆盖全部子站
 *
 * 主站:   www.zhaopin.com / sou.zhaopin.com
 * 闲才:   xiancai.zhaopin.com   (蓝领/劳力)
 * 政企:   govjob.zhaopin.com    (政府/国企)
 * 校园:   xiaoyuan.zhaopin.com  (校招)
 * 卓聘:   highpin.zhaopin.com   (高端/猎头)
 * 海外:   overseas.zhaopin.com  (海外招聘)
 */

class ZhaopinAdapter extends BaseAdapter {
  constructor() {
    super();
    this.name = '智联招聘';
    this.domain = 'zhaopin.com';
    this._detectSubSite();
  }

  _detectSubSite() {
    const h = window.location.hostname;
    if (h.includes('xiancai'))   this.name = '智联闲才';
    else if (h.includes('govjob'))   this.name = '政企招聘';
    else if (h.includes('xiaoyuan')) this.name = '智联校园';
    else if (h.includes('highpin'))  this.name = '智联卓聘';
    else if (h.includes('overseas')) this.name = '智引海外';
    else if (h.includes('sou'))      this.name = '智联招聘';
  }

  isSearchPage() {
    const h = window.location.hostname;
    const p = window.location.pathname;
    // 主站
    if (h.includes('sou.zhaopin.com')) return true;
    if (p.includes('/jobs/') || p.includes('/search')) return true;
    // 各子站路径特征
    if (h.includes('xiancai') && (p.includes('/list') || p.includes('/search') || p === '/' || p === '')) return true;
    if (h.includes('govjob') && (p.includes('/list') || p.includes('/search') || p === '/' || p === '')) return true;
    if (h.includes('xiaoyuan') && (p.includes('/jobs') || p.includes('/search') || p.includes('/full') || p === '/' || p === '')) return true;
    if (h.includes('highpin') && (p.includes('/jobs') || p.includes('/list') || p === '/' || p === '')) return true;
    if (h.includes('overseas') && (p.includes('/jobs') || p.includes('/list') || p.includes('/search') || p === '/' || p === '')) return true;
    // DOM 兜底
    return document.querySelector('.joblist-box, .search-result-list, [class*="joblist"], [class*="position-list"], [class*="search-list"]') !== null;
  }

  getJobElements() {
    const selectors = [
      // --- 智联校园 (xiaoyuan) 真实 DOM ---
      '.position-list__item', '.position-card',
      '[class*="position-list"] > div[class]',
      // --- 智联主站专用 ---
      '.joblist-box__item', '.joblist-box > div[class]',
      '.positionlist > .item', '.positionlist > div[class]',
      '.search-result-list > li', '.search-result-list > div[class]',
      '[class*="joblist-box"] > [class*="item"]',
      '[class*="joblist"] > [class*="item"]',
      '[class*="jobList"] > [class*="item"]',
      '.job-item', '.joblist-item',
      // --- 校园 (xiaoyuan) ---
      '.campus-job-item', '.campus-job-card',
      '[class*="campus"] > [class*="item"]', '[class*="campus"] > [class*="card"]',
      '.school-recruit-item', '.graduate-job-item',
      '[class*="school"] > [class*="job"]', '[class*="school"] > [class*="item"]',
      // --- 卓聘/高端 (highpin) ---
      '.highpin-item', '.highpin-card', '.executive-item',
      '[class*="high"] > [class*="job"]', '[class*="high"] > [class*="item"]',
      '.headhunt-item', '.vip-job-item',
      // --- 闲才/蓝领 (xiancai) ---
      '.worker-item', '.labor-item',
      '[class*="worker"] > [class*="item"]',
      // --- 政企 (govjob) ---
      '.gov-item', '.gov-job-item',
      '[class*="gov"] > [class*="item"]', '[class*="gov"] > [class*="job"]',
      // --- 海外 (overseas) ---
      '.overseas-item', '.abroad-job-item',
      '[class*="overseas"] > [class*="item"]', '[class*="overseas"] > [class*="job"]',
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
      // --- 卡片 ---
      'li[class*="job"]', 'li[class*="item"]', 'li[class*="position"]',
      'div[class*="job-card"]', 'div[class*="job-item"]',
      // --- 终极 ---
      'ul > li[class]', 'ol > li[class]',
    ];
    for (const sel of selectors) {
      try {
        const elements = document.querySelectorAll(sel);
        if (elements.length >= 3) return this._excludeOwnPanel(elements);
      } catch (e) { /* skip */ }
    }
    return [];
  }

  extractJobInfo(element) {
    // 智联校园的卡片结构特殊：职位名在 position-card__job-name
    const isCampus = !!(element.querySelector('.position-card__job-name'));
    const { title: baseTitle, company: baseCompany } = this._extractBoth(element);
    // 校园站优先用专用选择器
    const title = isCampus ? (element.querySelector('.position-card__job-name')?.textContent?.trim() || baseTitle) : baseTitle;
    const company = isCampus ? (element.querySelector('.position-card__company__tabs-item')?.textContent?.trim() || element.querySelector('.position-card__label')?.textContent?.trim() || baseCompany) : baseCompany;
    const url = this._extractJobUrl(element);
    const companyUrl = this._extractCompanyUrl(element);

    const salaryEl = element.querySelector('.position-card__salary, .jobinfo__salary, .salary, [class*="salary"], .zwyx, .salaryText');
    const salary = salaryEl ? salaryEl.textContent.trim() : '';

    const dateEl = element.querySelector('.jobinfo__time, .time, [class*="time"], [class*="date"], .fbdate');
    const date = dateEl ? dateEl.textContent.trim() : '';

    const locationEl = element.querySelector('.position-card__city-name, .jobinfo__area, .area, [class*="area"], .gzdd');
    const location = locationEl ? locationEl.textContent.trim() : '';

    const tags = Array.from(element.querySelectorAll('.position-card__tags__item, .jobinfo__tag, .job-tag, .welfare, [class*="tag"], .job-demand span'))
      .map(t => t.textContent.trim())
      .filter(Boolean);

    const companyTypeEl = element.querySelector('.company__type, [class*="company-type"]');
    const companyType = companyTypeEl ? companyTypeEl.textContent.trim() : '';

    return {
      id: 'zl_' + this._utf8ToBase64(title + company).slice(0, 32),
      title,
      company,
      url,
      companyUrl,
      salary,
      location,
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
    let elements = this.getJobElements();
    // 专用选择器未命中 → 降级到基类万能探测器
    if (!elements.length) elements = this._getAllPossibleCards(document);
    return elements.map(el => this.extractJobInfo(el));
  }

  async applyToPosition(element) {
    try {
      // 智联的投递按钮
      const applyBtn = element.querySelector('.btn-apply, .apply-btn, .btnApply, [class*="apply"], [class*="deliver"], a[href*="apply"]');
      if (!applyBtn) {
        return { success: false, message: '未找到投递按钮' };
      }

      const currentUrl = window.location.href;
      applyBtn.click();
      await this._sleep(2000);
      // 检测页面是否跳转
      const navigated = window.location.href !== currentUrl;
      if (navigated) {
        return { success: true, message: '已跳转', navigating: true };
      }
      return await this.waitForResult();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async waitForResult() {
    await this._sleep(1500);

    if (this.hasCaptcha()) {
      return { success: false, message: '需要验证码，请手动操作' };
    }

    // 智联可能有投递确认弹窗
    const confirmBtn = document.querySelector('.dialog-confirm, .btn-sure, .btn-confirm, [class*="confirm"], .el-message-box__btns .el-button--primary');
    if (confirmBtn) {
      confirmBtn.click();
      await this._sleep(500);
    }

    return { success: true, message: '投递成功' };
  }

  checkLoginStatus() {
    const userInfo = document.querySelector('.user-info, .user-center, .login-info, [class*="user"], .header-user');
    const loginBtn = document.querySelector('.btn-login, [class*="login-btn"], a[href*="login"]');

    if (loginBtn && /登录/.test(loginBtn.textContent)) {
      return { loggedIn: false, username: '' };
    }

    if (userInfo) {
      return { loggedIn: true, username: userInfo.textContent.trim().slice(0, 20) };
    }

    return { loggedIn: !!document.cookie.includes('ZHAOPIN'), username: '' };
  }

  hasCaptcha() {
    return document.querySelector('.captcha, .yidun, .geetest, [class*="captcha"], [class*="verify"], .nc_wrapper') !== null;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

window.__siteAdapter = new ZhaopinAdapter();
