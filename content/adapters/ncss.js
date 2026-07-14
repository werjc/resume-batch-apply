/**
 * 大学生就业服务平台 (ncss.cn) 适配器
 * 国家大学生就业服务平台
 */

class NcssAdapter extends BaseAdapter {
  constructor() { super(); this.name = '大学生就业服务平台'; this.domain = 'ncss.cn'; }

  isSearchPage() {
    return document.querySelector('.job-list, .search-list, [class*="search"], [class*="jobList"]') !== null;
  }

  getJobElements() {
    const selectors = [
      '.job-list > li', '.job-list > div[class]',
      '.search-list > li', '.search-list > div[class]',
      '[class*="jobList"] > li', '[class*="jobList"] > div[class]',
      '[class*="joblist"] > li', '[class*="joblist"] > div[class]',
      '.position-item', '.position-list > li', '.position-list > div[class]',
      '[class*="result-list"] > li', '[class*="result-list"] > div[class]',
      '[class*="list-box"] > li', '[class*="list-box"] > div[class]',
      '[class*="list-wrap"] > li', '[class*="list-wrap"] > div[class]',
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
    const salaryEl = element.querySelector('[class*="salary"], [class*="pay"]');
    const dateEl = element.querySelector('[class*="time"], [class*="date"]');
    const locationEl = element.querySelector('[class*="location"], [class*="city"]');
    const tags = Array.from(element.querySelectorAll('[class*="tag"], span'))
      .map(t => t.textContent.trim()).filter(Boolean);

    return {
      id: 'nc_' + this._utf8ToBase64(title + company).slice(0, 32),
      title, company, url, companyUrl,
      salary: salaryEl ? salaryEl.textContent.trim() : '',
      location: locationEl ? locationEl.textContent.trim() : '',
      date: dateEl ? dateEl.textContent.trim() : '',
      dateObj: this.parseDate(dateEl ? dateEl.textContent.trim() : ''),
      companyType: 'unknown',
      jobType: this._detectJobType(title, tags),
      education: this._extractEducation(title, tags),
      tags, element
    };
  }

  parseSearchResults() { return this.getJobElements().map(el => this.extractJobInfo(el)); }

  async applyToPosition(element) {
    try {
      const applyBtn = element.querySelector('button, [class*="apply"], [class*="deliver"], a');
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
    const userEl = document.querySelector('[class*="user"], [class*="login"]');
    return { loggedIn: !!userEl, username: userEl ? '已登录' : '' };
  }

  hasCaptcha() { return document.querySelector('[class*="captcha"], [class*="verify"]') !== null; }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

window.__siteAdapter = new NcssAdapter();
