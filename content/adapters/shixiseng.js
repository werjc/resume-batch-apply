/**
 * 实习僧 (shixiseng.com) 适配器
 * 实习生招聘平台
 */

class ShixisengAdapter extends BaseAdapter {
  constructor() { super(); this.name = '实习僧'; this.domain = 'shixiseng.com'; }

  isSearchPage() {
    return window.location.pathname.includes('/interns/') ||
           window.location.pathname.includes('/search') ||
           document.querySelector('.intern-list, .search-result, [class*="job-list"]') !== null;
  }

  getJobElements() {
    const selectors = [
      // --- 实习僧专用 ---
      '.intern-list > li', '.intern-list > div',
      '.intern-item', '.intern-card', '.intern-cell',
      '[class*="intern-list"] > li', '[class*="intern-list"] > div',
      '[class*="internList"] > li', '[class*="internList"] > div',
      '[class*="intern"] > li', '[class*="intern"] > div[class]',
      '.position-list > li', '.position-list > div',
      '.position-item', '.position-card',
      '[class*="position-list"] > li', '[class*="position-list"] > div',
      '[class*="position"] > li', '[class*="position"] > div[class]',
      // --- 通用 ---
      '.search-result > li', '.search-result > div[class]',
      '.result-list > li', '.result-list > div[class]',
      '[class*="result"] > li', '[class*="result"] > div[class]',
      '[class*="list-box"] > li', '[class*="list-box"] > div[class]',
      '[class*="list-wrap"] > li', '[class*="list-wrap"] > div[class]',
      '[class*="listWrap"] > li', '[class*="listWrap"] > div[class]',
      '.job-list > li', '.job-list > div[class]',
      '[class*="job-list"] > li', '[class*="job-list"] > div[class]',
      '[class*="joblist"] > li', '[class*="joblist"] > div[class]',
      '[class*="job"] > [class*="item"]',
      '[class*="recruit"] > li', '[class*="recruit"] > div[class]',
      // --- 卡片型 ---
      'li[class*="item"]', 'li[class*="card"]', 'li[class*="job"]',
      'li[class*="position"]', 'li[class*="intern"]',
      'div[class*="item"][class*="job"]', 'div[class*="item"][class*="position"]',
      'div[class*="card"][class*="job"]', 'div[class*="card"][class*="position"]',
      // --- 表格 ---
      'tr[class*="item"]', 'tr[class*="job"]',
      // --- 终极兜底：ul/ol 下带 class 的所有 li ---
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
      id: 'sxs_' + this._utf8ToBase64(title + company).slice(0, 32),
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

window.__siteAdapter = new ShixisengAdapter();
