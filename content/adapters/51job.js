/**
 * 前程无忧 (51job.com) 适配器
 * 搜索结果页URL: https://we.51job.com/... 或 https://search.51job.com/...
 */

class Job51Adapter extends BaseAdapter {
  constructor() { super(); this.name = '前程无忧'; this.domain = '51job.com'; }

  isSearchPage() {
    return window.location.pathname.includes('/search') ||
           document.querySelector('.j_joblist, .joblist, .result-list, [class*="jobList"]') !== null;
  }

  getJobElements() {
    const selectors = [
      // --- 51job专用 ---
      '.j_joblist > div[class]', '.joblist > div[class]',
      '.result-list > .item', '.result-list > div[class]',
      '[class*="jobList"] > [class*="item"]', '[class*="joblist"] > [class*="item"]',
      '.e', '.el', 'div[class*="e_"][class*="job"]',
      // --- 通用 ---
      '.search-result > li', '.search-result > div[class]',
      '[class*="result-list"] > li', '[class*="result-list"] > div[class]',
      '[class*="list-box"] > li', '[class*="list-box"] > div[class]',
      '[class*="list-wrap"] > li', '[class*="list-wrap"] > div[class]',
      '[class*="job-list"] > li', '[class*="job-list"] > div[class]',
      '[class*="joblist"] > li', '[class*="joblist"] > div[class]',
      '[class*="position"] > li', '[class*="position"] > div[class]',
      '[class*="intern"] > li', '[class*="intern"] > div[class]',
      'li[class*="job"]', 'li[class*="item"]', 'li[class*="position"]',
      'div[class*="job-card"]', 'div[class*="job-item"]',
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
    const salaryEl = element.querySelector('.sal, .salary, [class*="salary"]');
    const dateEl = element.querySelector('.time, [class*="date"], [class*="time"], .t5');
    const locationEl = element.querySelector('[class*="area"], [class*="location"], .t3');
    const tags = Array.from(element.querySelectorAll('[class*="tag"], [class*="welfare"], span'))
      .map(t => t.textContent.trim()).filter(Boolean);

    return {
      id: '51j_' + this._utf8ToBase64(title + company).slice(0, 32),
      title, company, url, companyUrl,
      salary: salaryEl ? salaryEl.textContent.trim() : '',
      location: locationEl ? locationEl.textContent.trim() : '',
      date: dateEl ? dateEl.textContent.trim() : '',
      dateObj: this.parseDate(dateEl ? dateEl.textContent.trim() : ''),
      companyType: this.detectCompanyType(company, element),
      jobType: this._detectJobType(title, tags),
      education: this._extractEducation(title, tags),
      tags, element
    };
  }

  parseSearchResults() { return this.getJobElements().map(el => this.extractJobInfo(el)); }

  async applyToPosition(element) {
    try {
      const applyBtn = element.querySelector('[class*="apply"], [class*="deliver"], .btn-apply, a[href*="apply"]');
      if (applyBtn) { const currentUrl = window.location.href; applyBtn.click(); await this._sleep(2000); if (window.location.href !== currentUrl) return { success: true, message: '已跳转', navigating: true }; }
      return await this.waitForResult();
    } catch (e) { return { success: false, message: e.message }; }
  }

  async waitForResult() {
    await this._sleep(1500);
    if (this.hasCaptcha()) return { success: false, message: '需要验证码' };
    return { success: true, message: '投递完成' };
  }

  checkLoginStatus() {
    const userEl = document.querySelector('.user-info, [class*="user"], .login-area');
    return { loggedIn: !!userEl, username: userEl ? '已登录' : '' };
  }

  hasCaptcha() { return document.querySelector('[class*="captcha"], [class*="verify"], .yidun') !== null; }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

window.__siteAdapter = new Job51Adapter();
