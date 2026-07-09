/**
 * 智联招聘 (zhaopin.com) 适配器
 *
 * 搜索结果页URL: https://sou.zhaopin.com/?...
 * 投递按钮常见文本："立即投递"、"申请职位"
 */

class ZhaopinAdapter extends BaseAdapter {
  constructor() {
    super();
    this.name = '智联招聘';
    this.domain = 'zhaopin.com';
  }

  isSearchPage() {
    return window.location.hostname.includes('sou.zhaopin.com') ||
           window.location.pathname.includes('/jobs/') ||
           document.querySelector('.joblist-box') !== null ||
           document.querySelector('.search-result-list') !== null;
  }

  getJobElements() {
    const selectors = [
      // --- 智联专用 ---
      '.joblist-box__item', '.joblist-box > div[class]',
      '.positionlist > .item', '.positionlist > div[class]',
      '.search-result-list > li', '.search-result-list > div[class]',
      '[class*="joblist-box"] > [class*="item"]',
      '[class*="joblist"] > [class*="item"]',
      '[class*="jobList"] > [class*="item"]',
      '.job-item', '.joblist-item',
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
        if (elements.length >= 3) return Array.from(elements);
      } catch (e) { /* skip */ }
    }
    return [];
  }

  extractJobInfo(element) {
    const { title, company } = this._extractBoth(element);
    const url = this._extractJobUrl(element);
    const companyUrl = this._extractCompanyUrl(element);

    const salaryEl = element.querySelector('.jobinfo__salary, .salary, [class*="salary"], .zwyx, .salaryText');
    const salary = salaryEl ? salaryEl.textContent.trim() : '';

    const dateEl = element.querySelector('.jobinfo__time, .time, [class*="time"], [class*="date"], .fbdate');
    const date = dateEl ? dateEl.textContent.trim() : '';

    const locationEl = element.querySelector('.jobinfo__area, .area, [class*="area"], .gzdd');
    const location = locationEl ? locationEl.textContent.trim() : '';

    const tags = Array.from(element.querySelectorAll('.jobinfo__tag, .job-tag, .welfare, [class*="tag"], .job-demand span'))
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
    return this.getJobElements().map(el => this.extractJobInfo(el));
  }

  async applyToPosition(element) {
    try {
      // 智联的投递按钮
      const applyBtn = element.querySelector('.btn-apply, .apply-btn, .btnApply, [class*="apply"], [class*="deliver"], a[href*="apply"]');
      if (!applyBtn) {
        return { success: false, message: '未找到投递按钮' };
      }

      applyBtn.click();
      await this._sleep(1500);
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
