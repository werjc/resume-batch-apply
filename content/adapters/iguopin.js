/**
 * 国聘 (iguopin.com) 适配器
 *
 * 国聘是国企/央企招聘平台
 * 搜索结果页URL: https://www.iguopin.com/search?...
 */

class IguopinAdapter extends BaseAdapter {
  constructor() {
    super();
    this.name = '国聘';
    this.domain = 'iguopin.com';
  }

  isSearchPage() {
    return window.location.pathname.includes('/search') ||
           document.querySelector('.search-result, .job-list, [class*="jobList"]') !== null;
  }

  getJobElements() {
    const selectors = [
      '.search-result-list > li', '.search-result-list > div[class]',
      '.job-list > li', '.job-list > div[class]',
      '[class*="jobList"] > li', '[class*="jobList"] > div[class]',
      '[class*="joblist"] > li', '[class*="joblist"] > div[class]',
      '.position-list > li', '.position-list > div[class]',
      '[class*="result-list"] > li', '[class*="result-list"] > div[class]',
      '[class*="list-box"] > li', '[class*="list-box"] > div[class]',
      '[class*="list-wrap"] > li', '[class*="list-wrap"] > div[class]',
      '[class*="position"] > li', '[class*="position"] > div[class]',
      '[class*="intern"] > li', '[class*="intern"] > div[class]',
      '[class*="recruit"] > li', '[class*="recruit"] > div[class]',
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

    const salaryEl = element.querySelector('[class*="salary"], [class*="pay"]');
    const salary = salaryEl ? salaryEl.textContent.trim() : '';

    const dateEl = element.querySelector('[class*="time"], [class*="date"], [class*="pub"]');
    const date = dateEl ? dateEl.textContent.trim() : '';

    const locationEl = element.querySelector('[class*="location"], [class*="city"], [class*="area"]');
    const location = locationEl ? locationEl.textContent.trim() : '';

    const tags = Array.from(element.querySelectorAll('[class*="tag"], span'))
      .map(t => t.textContent.trim())
      .filter(Boolean);

    return {
      id: 'ig_' + btoa(unescape(encodeURIComponent(title + company))).slice(0, 32),
      title, company, url, salary, location, date,
      dateObj: this.parseDate(date),
      companyType: 'state',
      jobType: this._detectJobType(title, tags),
      education: this._extractEducation(title, tags),
      tags, element
    };
  }

  parseSearchResults() {
    return this.getJobElements().map(el => this.extractJobInfo(el));
  }

  async applyToPosition(element) {
    try {

      const applyBtn = element.querySelector('[class*="apply"], [class*="deliver"], [class*="submit"], button');
      if (applyBtn) {
        applyBtn.click();
        await this._sleep(1500);
      }
      return await this.waitForResult();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async waitForResult() {
    await this._sleep(1500);
    if (this.hasCaptcha()) return { success: false, message: '需要验证码' };
    return { success: true, message: '投递完成' };
  }

  checkLoginStatus() {
    const userEl = document.querySelector('[class*="user"], [class*="login"], [class*="avatar"]');
    return { loggedIn: !!userEl, username: userEl ? '已登录' : '' };
  }

  hasCaptcha() {
    return document.querySelector('[class*="captcha"], [class*="verify"], .geetest') !== null;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

window.__siteAdapter = new IguopinAdapter();
