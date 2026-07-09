/**
 * 校友邦 (xiaoyoubang.com) 适配器
 * 校友网络实习就业平台
 */

class XiaoyoubangAdapter extends BaseAdapter {
  constructor() { super(); this.name = '校友邦'; this.domain = 'xiaoyoubang.com'; }

  isSearchPage() {
    return document.querySelector('.job-list, .position-list, [class*="search"], [class*="job"]') !== null;
  }

  getJobElements() {
    const selectors = [
      '.job-list > li', '.job-list > div[class]',
      '.position-list > li', '.position-list > div[class]',
      '[class*="job"] > li', '[class*="job"] > div[class]',
      '[class*="jobList"] > li', '[class*="jobList"] > div[class]',
      '.recruit-item', '.recruit-list > li', '.recruit-list > div[class]',
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
      id: 'xyb_' + this._utf8ToBase64(title + company).slice(0, 32),
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
      const applyBtn = element.querySelector('[class*="apply"], [class*="deliver"], button, a');
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
    const userEl = document.querySelector('[class*="user"], [class*="login"], [class*="avatar"]');
    return { loggedIn: !!userEl, username: userEl ? '已登录' : '' };
  }

  hasCaptcha() { return document.querySelector('[class*="captcha"], [class*="verify"]') !== null; }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

window.__siteAdapter = new XiaoyoubangAdapter();
