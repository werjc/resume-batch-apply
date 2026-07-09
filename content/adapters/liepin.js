/**
 * 猎聘 (liepin.com) 适配器
 * 中高端人才招聘平台
 */

class LiepinAdapter extends BaseAdapter {
  constructor() { super(); this.name = '猎聘'; this.domain = 'liepin.com'; }

  isSearchPage() {
    return window.location.pathname.includes('/job/') ||
           document.querySelector('.job-list-box, .search-job-result, .result-list, [class*="job-list"]') !== null;
  }

  getJobElements() {
    const selectors = [
      '.job-list-box > li', '.job-list-box > div[class]',
      '.search-job-result > li', '.search-job-result > div[class]',
      '.result-list > li', '.result-list > div[class]',
      '[class*="job-list"] > li', '[class*="job-list"] > div[class]',
      '[class*="joblist"] > li', '[class*="joblist"] > div[class]',
      '.job-card', '.job-card-box',
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
    const salaryEl = element.querySelector('[class*="salary"], .salary, .job-salary');
    const dateEl = element.querySelector('[class*="time"], [class*="date"], .publish-time');
    const locationEl = element.querySelector('[class*="area"], [class*="location"], .area');
    const tags = Array.from(element.querySelectorAll('[class*="tag"], [class*="label"], span'))
      .map(t => t.textContent.trim()).filter(Boolean);

    return {
      id: 'lp_' + btoa(unescape(encodeURIComponent(title + company))).slice(0, 32),
      title, company, url,
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
      const applyBtn = element.querySelector('[class*="apply"], [class*="deliver"], .btn-apply, button');
      if (applyBtn) { applyBtn.click(); await this._sleep(1500); }
      return await this.waitForResult();
    } catch (e) { return { success: false, message: e.message }; }
  }

  async waitForResult() {
    await this._sleep(1500);
    if (this.hasCaptcha()) return { success: false, message: '需要验证码' };
    return { success: true, message: '投递完成' };
  }

  checkLoginStatus() {
    const userEl = document.querySelector('.user-info, [class*="user"], .header-right');
    return { loggedIn: !!userEl, username: userEl ? '已登录' : '' };
  }

  detectCompanyType(companyName, element) {
    const el = element || document;
    const tags = el.querySelectorAll('[class*="tag"], [class*="type"]');
    for (const tag of tags) {
      const text = tag.textContent;
      if (/上市/.test(text)) return 'listed';
      if (/国企|央企|国有/.test(text)) return 'state';
      if (/外资|外企/.test(text)) return 'foreign';
      if (/民营/.test(text)) return 'private';
    }
    return 'unknown';
  }

  hasCaptcha() { return document.querySelector('[class*="captcha"], [class*="verify"]') !== null; }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

window.__siteAdapter = new LiepinAdapter();
