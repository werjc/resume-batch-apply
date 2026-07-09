/**
 * 内容脚本入口 — 注入招聘网站，负责：解析岗位、投递执行、侧边栏面板
 */
(function () {
  'use strict';

  // ===== 状态 =====
  let isApplying = false, stopRequested = false, applyQueue = [];
  let panelVisible = false;
  let allJobs = [], filteredJobs = [], selectedIds = new Set();
  let currentSiteName = '';
  let jobElementMap = new Map(); // id → DOM元素，投递时直接用，不靠ID查找

  function getAdapter() { return window.__siteAdapter || null; }

  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((req, sender, sendResp) => {
    const ad = getAdapter();
    if (req.action === 'togglePanel') { togglePanel(); sendResp({ ok: true }); return; }
    switch (req.action) {
      case 'parseJobs': {
        if (!ad) return sendResp({ success: false, error: '不受支持' });
        const jobs = ad.parseSearchResults();
        sendResp({ success: true, jobs: jobs.map(j => ({ id: j.id, title: j.title, company: j.company, url: j.url || '', salary: j.salary, location: j.location, date: j.date, companyType: j.companyType, jobType: j.jobType, education: j.education || 'none', tags: j.tags })) });
        return;
      }
      case 'checkStatus': {
        if (!ad) return sendResp({ success: false, error: '不受支持' });
        const st = ad.checkLoginStatus();
        sendResp({ success: true, siteName: ad.name, loggedIn: st.loggedIn, username: st.username, isSearchPage: ad.isSearchPage(), hasCaptcha: ad.hasCaptcha(), isApplying });
        return;
      }
      case 'startApply': {
        if (!ad || isApplying) return sendResp({ success: false, error: isApplying ? '进行中' : '不受支持' });
        const ids = req.jobIds || [];
        if (!ids.length) return sendResp({ success: false, error: '没有选择' });
        sendResp({ success: true });
        applyQueue = [...ids]; stopRequested = false; isApplying = true;
        executeApply(ad);
        return;
      }
      case 'stopApply': {
        if (!isApplying) return sendResp({ success: false, error: '没有任务' });
        stopRequested = true; isApplying = false;
        sendResp({ success: true });
        chrome.runtime.sendMessage({ type: 'applyStopped', remaining: applyQueue.length }).catch(() => {});
        return;
      }
      case 'stopCrawl': { stopCrawl = true; sendResp({ success: true }); return; }
      case 'crawlPages': {
        if (!ad) return sendResp({ success: false, error: '不受支持' });
        sendResp({ success: true });
        crawlAllPagesAsync(ad, Math.min(req.maxPages || 5, 50));
        return;
      }
    }
    return true;
  });

  // ===== 批量投递（基于元素直接操作） =====
  async function executeApply(ad) {
    const total = applyQueue.length; let done = 0; const results = [];
    for (const id of applyQueue) {
      if (stopRequested) { results.push({ jobId: id, success: false, message: '已停止' }); break; }
      const el = jobElementMap.get(id);
      if (!el) { results.push({ jobId: id, success: false, message: '未找到元素' }); done++; continue; }
      try {
        const r = await ad.applyToPosition(el);
        results.push({ jobId: id, ...r });
      } catch (e) {
        results.push({ jobId: id, success: false, message: e.message });
      }
      done++;
      chrome.runtime.sendMessage({ type: 'applyProgress', current: done, total, jobId: id, lastResult: results[results.length - 1] }).catch(() => {});
      if (!stopRequested && done < total) await sleep(2000 + Math.random() * 2000);
    }
    isApplying = false;
    chrome.runtime.sendMessage({ type: 'applyComplete', total, completed: done, successCount: results.filter(r => r.success).length, failCount: results.filter(r => !r.success).length, results }).catch(() => {});
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ===== 多页爬取 =====
  let stopCrawl = false;
  async function crawlAllPagesAsync(ad, maxPages) {
    stopCrawl = false;
    try {
      const all = await ad.crawlAllPages(window.location.href, maxPages, (cur, tot) => {
        if (stopCrawl) return;
        chrome.runtime.sendMessage({ type: 'crawlProgress', currentPage: cur, totalPages: tot }).catch(() => {});
      });
      if (stopCrawl) { chrome.runtime.sendMessage({ type: 'crawlComplete', stopped: true, totalJobs: 0, jobs: [] }).catch(() => {}); return; }
      chrome.runtime.sendMessage({ type: 'crawlComplete', stopped: false, totalJobs: all.length, jobs: all.map(j => ({ id: j.id, title: j.title, company: j.company, url: j.url || '', salary: j.salary, location: j.location, date: j.date, companyType: j.companyType, jobType: j.jobType, education: j.education || 'none', tags: j.tags })) }).catch(() => {});
    } catch (e) {
      chrome.runtime.sendMessage({ type: 'crawlComplete', stopped: false, totalJobs: 0, error: e.message, jobs: [] }).catch(() => {});
    }
  }

  // ============================================================
  //  侧边栏面板
  // ============================================================
  let panelEl = null;

  function togglePanel() {
    if (panelEl) {
      panelVisible = !panelVisible;
      if (panelVisible) { panelEl.classList.remove('rba-collapsed'); setPageMargin(true); refreshPanelData(); }
      else { panelEl.classList.add('rba-collapsed'); setPageMargin(false); }
    } else {
      createPanel(); panelVisible = true;
      panelEl.classList.remove('rba-collapsed'); setPageMargin(true); refreshPanelData();
    }
  }

  function setPageMargin(on) {
    if (!on) {
      document.documentElement.style.marginRight = '0px';
      if (document.body) document.body.style.marginRight = '0px';
    } else {
      const w = panelEl ? panelEl.getBoundingClientRect().width : 400;
      document.documentElement.style.marginRight = Math.round(w) + 'px';
      document.documentElement.style.transition = 'margin-right .25s ease';
      if (document.body) { document.body.style.marginRight = Math.round(w) + 'px'; document.body.style.transition = 'margin-right .25s ease'; }
    }
  }

  function createPanel() {
    const ad = getAdapter();
    currentSiteName = ad ? ad.name : '';
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    panelEl = document.createElement('div');
    panelEl.id = 'rba-panel';
    panelEl.innerHTML = PANEL_HTML;
    document.body.appendChild(panelEl);
    bindPanelEvents();
  }

  function bindPanelEvents() {
    const $ = s => panelEl.querySelector(s);
    // 折叠
    $('.rba-close').addEventListener('click', () => { panelVisible = false; panelEl.classList.add('rba-collapsed'); setPageMargin(false); toast('已折叠，点工具栏图标重新打开', 'info'); });
    // 筛选折叠
    $('.rba-filter-toggle').addEventListener('click', () => { $('.rba-filter-toggle').classList.toggle('collapsed'); $('.rba-filter-panel').classList.toggle('collapsed'); saveFilters(); });
    // 筛选变更
    ['filterDate','filterCompanyType','filterEducation'].forEach(id => { $(`#${id}`).addEventListener('change', () => { applyFilters(); saveFilters(); }); });
    // 全选/反选
    $('.rba-btn-selectall').addEventListener('click', () => { filteredJobs.forEach(j => selectedIds.add(j.id)); renderJobList(); updateJobCount(); });
    $('.rba-btn-invert').addEventListener('click', () => { const s = new Set(); filteredJobs.forEach(j => { if (!selectedIds.has(j.id)) s.add(j.id); }); selectedIds = s; renderJobList(); updateJobCount(); });
    // 爬取
    $('.rba-btn-crawl').addEventListener('click', startCrawl);
    $('.rba-btn-refresh').addEventListener('click', refreshPanelData);
    $('.rba-btn-stopcrawl').addEventListener('click', () => { stopCrawl = true; toast('正在停止爬取...', 'info'); });
    // 投递
    $('.rba-btn-apply').addEventListener('click', startApply);
    $('.rba-btn-schedule').addEventListener('click', openSchedule);
    $('.rba-btn-stop').addEventListener('click', stopApply);
    // 定时弹窗
    $('.rba-modal-cancel').addEventListener('click', () => $('.rba-modal').classList.add('hidden'));
    $('.rba-modal-confirm').addEventListener('click', confirmSchedule);
    $('.rba-modal').addEventListener('click', e => { if (e.target === $('.rba-modal')) $('.rba-modal').classList.add('hidden'); });
    // 后台消息
    chrome.runtime.onMessage.addListener(handleBgMsg);
  }

  // ===== 数据刷新 =====
  async function refreshPanelData() {
    const ad = getAdapter();
    if (!ad) return;
    const st = ad.checkLoginStatus();
    panelEl.querySelector('.rba-sitename').textContent = ad.name;
    panelEl.querySelector('.rba-loginstatus').textContent = st.loggedIn ? '已登录' : '未登录';
    panelEl.querySelector('.rba-loginstatus').className = 'rba-loginstatus ' + (st.loggedIn ? 'rba-ok' : 'rba-warn');
    await loadFilters();
    try {
      jobElementMap.clear();
      const raw = ad.parseSearchResults();
      allJobs = raw.map(j => {
        if (j.element) jobElementMap.set(j.id, j.element);
        return { id: j.id, title: j.title, company: j.company, url: j.url || '', salary: j.salary, location: j.location, date: j.date, companyType: j.companyType, jobType: j.jobType, education: j.education || 'none', tags: j.tags };
      });
    } catch (e) { allJobs = []; jobElementMap.clear(); }
    if (ad._resolveCompanyTypesBatch) { try { allJobs = await ad._resolveCompanyTypesBatch(allJobs); } catch (e) {} }
    selectedIds.clear(); applyFilters();
  }

  // ===== 筛选 =====
  function applyFilters() {
    const df = panelEl.querySelector('#filterDate').value;
    const cf = panelEl.querySelector('#filterCompanyType').value;
    const ef = panelEl.querySelector('#filterEducation').value;
    filteredJobs = allJobs.filter(job => {
      if (df !== 'all' && job.dateObj) { const days = (Date.now() - job.dateObj.getTime()) / 86400000; if (days > parseInt(df)) return false; }
      if (cf !== 'all' && job.companyType !== cf) return false;
      if (ef !== 'all') { const lv = { none: 0, associate: 1, bachelor: 2, master: 3, doctor: 4 }; if ((lv[job.education] || 0) > (lv[ef] || 0)) return false; }
      return true;
    });
    const ids = new Set(filteredJobs.map(j => j.id));
    for (const id of selectedIds) { if (!ids.has(id)) selectedIds.delete(id); }
    renderJobList(); updateJobCount();
  }

  function renderJobList() {
    const list = panelEl.querySelector('.rba-joblist');
    if (!filteredJobs.length) { list.innerHTML = '<div class="rba-empty">没有匹配的岗位，点「深度爬取」扫描多页</div>'; return; }
    list.innerHTML = filteredJobs.map(j => {
      const chk = selectedIds.has(j.id) ? 'checked' : '';
      const hasUrl = j.url && j.url !== '';
      return `<div class="rba-jobitem" data-id="${esc(j.id)}">
        <input type="checkbox" class="rba-cb" data-id="${esc(j.id)}" ${chk}>
        <div class="rba-jobinfo">
          <div class="rba-jobtitle ${hasUrl?'rba-link':''}" ${hasUrl?`data-url="${esc(j.url)}" title="点击在新标签页打开详情"`:''}>${esc(j.title)}${hasUrl?'<span class="rba-linkicon">↗</span>':''}</div>
          <div class="rba-jobcompany">${esc(j.company)}${j.salary?' · '+esc(j.salary):''}</div>
          <div class="rba-jobmeta">${j.education&&j.education!=='none'?`<span>${eduLabel(j.education)}</span>`:''}${j.jobType?`<span>${jobTypeLabel(j.jobType)}</span>`:''}${j.date?`<span>${esc(j.date)}</span>`:''}${j.location?`<span>${esc(j.location)}</span>`:''}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.rba-cb').forEach(cb => cb.addEventListener('change', e => { e.stopPropagation(); cb.checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id); updateJobCount(); }));
    list.querySelectorAll('.rba-jobitem').forEach(item => item.addEventListener('click', e => { if (e.target.closest('.rba-link') || e.target.closest('.rba-cb')) return; const cb = item.querySelector('.rba-cb'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }));
    list.querySelectorAll('.rba-link').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); if (el.dataset.url) window.open(el.dataset.url, '_blank'); }));
  }

  function updateJobCount() { panelEl.querySelector('.rba-jobcount').textContent = `${filteredJobs.length} 个岗位` + (selectedIds.size ? `（已选 ${selectedIds.size} 个）` : ''); }

  // ===== 投递面板操作 =====
  async function startApply() {
    if (!selectedIds.size) return toast('请先勾选要投递的岗位', 'info');
    if (isApplying) return toast('投递已在进行中', 'info');
    const ids = Array.from(selectedIds);
    const ad = getAdapter();
    if (!ad) return toast('当前网站不受支持', 'error');

    // 本地直接执行（content script 中 chrome.tabs 不可用）
    applyQueue = [...ids]; stopRequested = false; isApplying = true;
    updateApplyUI(true); updateProgress(0, ids.length);
    executeApply(ad);

    const names = filteredJobs.filter(j => ids.includes(j.id)).map(j => j.title).slice(0, 3);
    toast(`开始投递 ${ids.length} 个岗位：${names.join('、')}${ids.length>3?'…':''}`, 'success');
  }

  async function stopApply() {
    stopRequested = true; isApplying = false;
    updateApplyUI(false);
    chrome.runtime.sendMessage({ type: 'applyStopped', remaining: applyQueue.length }).catch(() => {});
    toast('已停止投递', 'info');
  }

  async function startCrawl() {
    const max = parseInt(panelEl.querySelector('#crawlPages').value) || 5;
    const ad = getAdapter();
    if (!ad) return toast('当前网站不受支持', 'error');
    panelEl.querySelector('.rba-btn-crawl').disabled = true; panelEl.querySelector('.rba-btn-crawl').textContent = '爬取中...';
    panelEl.querySelector('.rba-crawlprogress').classList.remove('hidden'); panelEl.querySelector('.rba-btn-stopcrawl').classList.remove('hidden');
    crawlAllPagesAsync(ad, Math.min(max, 50));
  }
  function resetCrawlUI() { const b = panelEl.querySelector('.rba-btn-crawl'); b.disabled = false; b.textContent = '深度爬取'; panelEl.querySelector('.rba-crawlprogress').classList.add('hidden'); panelEl.querySelector('.rba-btn-stopcrawl').classList.add('hidden'); }

  // ===== 定时 =====
  function openSchedule() {
    if (!selectedIds.size) return toast('请先勾选岗位', 'info');
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    panelEl.querySelector('#scheduleTime').value = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
    panelEl.querySelector('#scheduleTime').min = new Date().toISOString().slice(0, 16);
    panelEl.querySelector('.rba-modal').classList.remove('hidden');
  }
  async function confirmSchedule() {
    const v = panelEl.querySelector('#scheduleTime').value; if (!v) return toast('请选择时间', 'info');
    const st = new Date(v).toISOString(); if (new Date(st).getTime() <= Date.now()) return toast('请选未来时间', 'info');
    const ids = Array.from(selectedIds); const jobs = filteredJobs.filter(j => ids.includes(j.id)).map(j => ({ id: j.id, title: j.title, company: j.company }));
    try { const resp = await chrome.runtime.sendMessage({ type: 'scheduleApply', jobs, scheduledTime: st, siteUrl: window.location.href, siteName: currentSiteName }); if (resp?.success) { panelEl.querySelector('.rba-modal').classList.add('hidden'); toast(`已定时：${fmtTime(st)}，${jobs.length} 个岗位`, 'success'); } else toast('失败：'+(resp?.error||''), 'error'); } catch (e) { toast('设置失败', 'error'); }
  }

  // ===== 消息处理 =====
  function handleBgMsg(msg) {
    switch (msg.type) {
      case 'applyProgress': updateProgress(msg.current, msg.total); break;
      case 'applyComplete': isApplying = false; updateApplyUI(false); updateProgress(msg.total, msg.total); toast(`投递完成！成功 ${msg.successCount}，失败 ${msg.failCount}`, msg.failCount ? 'info' : 'success'); break;
      case 'applyStopped': isApplying = false; updateApplyUI(false); break;
      case 'crawlProgress': panelEl.querySelector('.rba-crawltext').textContent = `爬取第 ${msg.currentPage}/${msg.totalPages} 页...`; break;
      case 'crawlComplete': resetCrawlUI(); if (msg.stopped) { toast('爬取已停止', 'info'); return; } if (msg.error) { toast('出错：'+msg.error, 'error'); return; } allJobs = msg.jobs || []; selectedIds.clear(); applyFilters(); toast(`深度爬取完成！共 ${allJobs.length} 个岗位`, 'success'); break;
    }
  }
  function updateProgress(cur, tot) { if (!tot) { panelEl.querySelector('.rba-progress').classList.add('hidden'); return; } panelEl.querySelector('.rba-progress').classList.remove('hidden'); panelEl.querySelector('.rba-bar').style.width = Math.round(cur/tot*100)+'%'; panelEl.querySelector('.rba-progresstext').textContent = `${cur}/${tot}`; }
  function updateApplyUI(on) { panelEl.querySelector('.rba-btn-apply').disabled = on; panelEl.querySelector('.rba-btn-apply').textContent = on ? '投递中...' : '立即投递'; panelEl.querySelector('.rba-btn-schedule').disabled = on; panelEl.querySelector('.rba-btn-stop').classList.toggle('hidden', !on); if (on) panelEl.querySelector('.rba-progress').classList.remove('hidden'); }

  // ===== 筛选记忆 =====
  async function saveFilters() { const d = { filterDate: panelEl.querySelector('#filterDate').value, filterCompanyType: panelEl.querySelector('#filterCompanyType').value, filterEducation: panelEl.querySelector('#filterEducation').value, filterCollapsed: panelEl.querySelector('.rba-filter-toggle').classList.contains('collapsed') }; await chrome.storage.local.set({ popupFilters: d }).catch(() => {}); }
  async function loadFilters() { try { const r = await chrome.storage.local.get('popupFilters'); const d = r.popupFilters; if (!d) return; if (d.filterDate) panelEl.querySelector('#filterDate').value = d.filterDate; if (d.filterCompanyType) panelEl.querySelector('#filterCompanyType').value = d.filterCompanyType; if (d.filterEducation) panelEl.querySelector('#filterEducation').value = d.filterEducation; if (d.filterCollapsed) { panelEl.querySelector('.rba-filter-toggle').classList.add('collapsed'); panelEl.querySelector('.rba-filter-panel').classList.add('collapsed'); } } catch (e) {} }

  // ===== 工具 =====
  let _toastT = null;
  function toast(msg, type) { const el = panelEl.querySelector('.rba-toast'); el.textContent = msg; el.className = 'rba-toast rba-toast-' + (type || 'info'); el.classList.remove('hidden'); clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.add('hidden'), 3000); }
  function jobTypeLabel(t) { return { fulltime: '全职', intern: '实习', parttime: '兼职' }[t] || t; }
  function eduLabel(e) { return { none: '学历不限', associate: '大专', bachelor: '本科', master: '硕士', doctor: '博士' }[e] || ''; }
  function fmtTime(s) { const d = new Date(s); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ============================================================
  const PANEL_HTML = `
  <div class="rba-header"><span>一键投递</span><span class="rba-header-site"><span class="rba-sitename">--</span> · <span class="rba-loginstatus">检测中</span></span><button class="rba-close">×</button></div>
  <div class="rba-body">
    <div class="rba-filter-section">
      <div class="rba-filter-toggle"><span class="rba-arrow">▼</span> 筛选条件</div>
      <div class="rba-filter-panel">
        <div class="rba-frow"><label>发布日期</label><select id="filterDate"><option value="all">不限</option><option value="1">24小时内</option><option value="3">3天内</option><option value="7">7天内</option><option value="14">14天内</option><option value="30">30天内</option></select></div>
        <div class="rba-frow"><label>公司类型</label><select id="filterCompanyType"><option value="all">不限</option><option value="listed">上市公司</option><option value="state">国企/央企</option><option value="foreign">外企</option><option value="private">民营企业</option><option value="startup">创业公司</option></select></div>
        <div class="rba-frow"><label>学历要求</label><select id="filterEducation"><option value="all">不限</option><option value="none">学历不限</option><option value="associate">大专及以上</option><option value="bachelor">本科及以上</option><option value="master">硕士及以上</option><option value="doctor">博士</option></select></div>
      </div>
    </div>
    <div class="rba-crawltool">
      <select id="crawlPages"><option value="1">仅当前页</option><option value="3">爬取 3 页</option><option value="5" selected>爬取 5 页</option><option value="10">爬取 10 页</option><option value="20">爬取 20 页</option></select>
      <button class="rba-btn-crawl">深度爬取</button>
      <button class="rba-btn-refresh">刷新</button>
      <div class="rba-crawlprogress hidden"><span class="rba-crawltext">爬取第 1/5 页...</span><button class="rba-btn-stopcrawl hidden">停止</button></div>
    </div>
    <div class="rba-listheader"><span class="rba-jobcount">0 个岗位</span><div><button class="rba-btn-selectall">全选</button><button class="rba-btn-invert">反选</button></div></div>
    <div class="rba-joblist"><div class="rba-empty">打开招聘网站搜索结果页</div></div>
    <div class="rba-progress hidden"><div class="rba-barwrap"><div class="rba-bar" style="width:0%"></div></div><div class="rba-progresstext">0/0</div></div>
    <div class="rba-actions">
      <button class="rba-btn-apply">立即投递</button><button class="rba-btn-schedule">定时投递</button>
      <button class="rba-btn-stop hidden">停止投递</button>
    </div>
  </div>
  <div class="rba-modal hidden"><div class="rba-modalbox"><h3>设定投递时间</h3><input type="datetime-local" id="scheduleTime"><p class="rba-hint">到设定时间后，自动在当前页面投递已选岗位</p><div class="rba-modalfoot"><button class="rba-modal-cancel">取消</button><button class="rba-modal-confirm">确认定时</button></div></div></div>
  <div class="rba-toast hidden"></div>`;

  const PANEL_CSS = `
#rba-panel{position:fixed;top:0;right:0;width:clamp(380px,34vw,500px);height:100vh;background:#fff;border-left:1px solid #D5E4ED;z-index:2147483646;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#2C3E50;display:flex;flex-direction:column;overflow:hidden;user-select:none;transition:transform .25s ease}
#rba-panel.rba-collapsed{transform:translateX(98%)}
#rba-panel *{box-sizing:border-box;margin:0;padding:0}
#rba-panel button,#rba-panel select{font-family:inherit}
.rba-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:linear-gradient(135deg,#7EC8E3,#5BA4BD);color:#fff;font-size:16px;font-weight:600;flex-shrink:0;gap:8px}
.rba-header-site{font-size:12px;font-weight:400;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rba-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;padding:2px 6px;line-height:1;opacity:.8;flex-shrink:0;border-radius:4px}
.rba-close:hover{opacity:1;background:rgba(255,255,255,.2)}
.rba-body{overflow-y:auto;flex:1;min-height:0;padding:0 0 10px}
.rba-filter-section{margin:8px 16px 6px;border:1px solid #e2e9ef;border-radius:8px;overflow:hidden}
.rba-filter-toggle{padding:11px 14px;cursor:pointer;font-size:13px;font-weight:500;color:#5a7a95;background:#f8fafb;display:flex;align-items:center;gap:6px}
.rba-filter-toggle:hover{background:#eef4f7}
.rba-arrow{font-size:10px;transition:.2s;color:#9aabbb}
.rba-filter-toggle.collapsed .rba-arrow{transform:rotate(-90deg)}
.rba-filter-panel{padding:6px 14px 12px}
.rba-filter-panel.collapsed{display:none}
.rba-frow{display:flex;align-items:center;gap:8px;margin-top:9px}
.rba-frow label{width:60px;font-size:12px;color:#5a7a95;flex-shrink:0;text-align:right}
.rba-frow select{flex:1;padding:7px 8px;border:1px solid #D5E4ED;border-radius:5px;font-size:13px;color:#2C3E50;outline:none;background:#fff;cursor:pointer}
.rba-frow select:focus{border-color:#7EC8E3;box-shadow:0 0 0 2px rgba(126,200,227,.2)}
.rba-crawltool{padding:10px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #eee;margin:0 4px}
.rba-crawltool select{padding:7px 10px;border:1px solid #D5E4ED;border-radius:6px;font-size:12px;outline:none;cursor:pointer}
.rba-crawltool button{padding:7px 14px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:500;white-space:nowrap;transition:background .15s}
.rba-btn-crawl{background:#3498DB;color:#fff}
.rba-btn-crawl:hover:not(:disabled){background:#2980B9}
.rba-btn-crawl:disabled{opacity:.5;cursor:not-allowed}
.rba-btn-refresh{background:#fff;color:#5a7a95;border:1px solid #D5E4ED!important}
.rba-btn-refresh:hover{background:#f0f7fa}
.rba-crawlprogress{width:100%;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#3498DB;margin-top:5px}
.rba-btn-stopcrawl{background:none!important;border:none!important;color:#E74C3C;cursor:pointer;font-size:12px;padding:0!important}
.rba-btn-stopcrawl:hover{text-decoration:underline}
.rba-crawlprogress.hidden,.rba-progress.hidden,.rba-modal.hidden,.rba-toast.hidden,.rba-collapsed .rba-body{display:none!important}
.rba-listheader{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;font-size:13px;color:#5a7a95;border-bottom:1px solid #eee;margin:0 4px}
.rba-jobcount{font-weight:500}
.rba-listheader button{background:none;border:none;color:#3498DB;cursor:pointer;font-size:12px;padding:4px 10px;border-radius:4px;font-weight:500}
.rba-listheader button:hover{background:#eaf4fb;text-decoration:none}
.rba-joblist{flex:1;overflow-y:auto;max-height:none;margin:0 4px}
.rba-empty{padding:40px 16px;text-align:center;color:#b0bec5;font-size:13px}
.rba-jobitem{display:flex;align-items:flex-start;padding:12px 18px;cursor:pointer;border-bottom:1px solid #f2f5f8;transition:background .12s}
.rba-jobitem:hover{background:#f5f9fb}
.rba-cb{width:17px;height:17px;min-width:17px;margin-right:12px;margin-top:2px;cursor:pointer;accent-color:#5BA4BD;flex-shrink:0}
.rba-jobinfo{flex:1;min-width:0}
.rba-jobtitle{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
.rba-link{color:#3498DB;cursor:pointer}
.rba-link:hover{text-decoration:underline;color:#1a6fb5}
.rba-linkicon{font-size:11px;margin-left:3px;opacity:0;transition:.15s}
.rba-link:hover .rba-linkicon{opacity:1}
.rba-jobcompany{font-size:12px;color:#6B8299;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rba-jobmeta{font-size:11px;color:#a0b0c0;display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.rba-jobmeta span{background:#f4f7fb;padding:2px 8px;border-radius:3px;white-space:nowrap}
.rba-progress{margin:8px 18px;padding:10px 0;border-top:1px solid #eef1f4}
.rba-barwrap{height:6px;background:#e4eaf0;border-radius:3px;overflow:hidden}
.rba-bar{height:100%;background:linear-gradient(90deg,#7EC8E3,#3498DB);border-radius:3px;transition:width .3s}
.rba-progresstext{text-align:center;font-size:11px;color:#a0b0c0;margin-top:6px}
.rba-actions{display:flex;gap:12px;padding:14px 18px;border-top:1px solid #e8edf2;flex-wrap:wrap;flex-shrink:0}
.rba-actions button{padding:13px 0;border-radius:8px;font-size:14px;cursor:pointer;border:none;font-weight:600;flex:1;min-width:120px;transition:all .15s}
.rba-actions button:active{transform:scale(.98)}
.rba-btn-apply{background:linear-gradient(135deg,#7EC8E3,#5BA4BD);color:#fff;font-size:15px!important;letter-spacing:.3px}
.rba-btn-apply:hover:not(:disabled){box-shadow:0 4px 16px rgba(126,200,227,.5);transform:translateY(-1px)}
.rba-btn-apply:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.rba-btn-schedule{background:#f8fafb;color:#5a7a95;border:1px solid #dce4ec!important}
.rba-btn-schedule:hover:not(:disabled){background:#eaf1f7;border-color:#7EC8E3!important;color:#2C3E50}
.rba-btn-schedule:disabled{opacity:.4;cursor:not-allowed}
.rba-btn-stop{background:#E74C3C!important;color:#fff!important;flex:3 0 100%!important;font-size:15px!important}
.rba-btn-stop:hover:not(:disabled){background:#C0392B!important;box-shadow:0 4px 14px rgba(231,76,60,.4)}
.rba-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:2147483647;display:flex;align-items:center;justify-content:center}
.rba-modalbox{background:#fff;border-radius:12px;padding:24px;width:340px;box-shadow:0 10px 36px rgba(0,0,0,.2)}
.rba-modalbox h3{font-size:16px;margin-bottom:14px;color:#2C3E50}
.rba-modalbox input{width:100%;padding:9px 12px;border:1px solid #D5E4ED;border-radius:6px;font-size:14px;margin-bottom:10px;outline:none}
.rba-modalbox input:focus{border-color:#7EC8E3;box-shadow:0 0 0 3px rgba(126,200,227,.2)}
.rba-hint{font-size:12px;color:#a0b0c0;margin-bottom:16px;line-height:1.5}
.rba-modalfoot{display:flex;justify-content:flex-end;gap:10px}
.rba-modal-cancel,.rba-modal-confirm{padding:9px 22px;border-radius:6px;font-size:13px;cursor:pointer;border:none;font-weight:500}
.rba-modal-cancel{background:#f0f3f6;color:#5a7a95}
.rba-modal-cancel:hover{background:#e2e8ed}
.rba-modal-confirm{background:linear-gradient(135deg,#7EC8E3,#5BA4BD);color:#fff}
.rba-modal-confirm:hover{box-shadow:0 3px 12px rgba(126,200,227,.45)}
.rba-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);padding:11px 28px;border-radius:8px;font-size:13px;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.15);animation:rba-fadein .3s;pointer-events:none;max-width:500px;text-align:center}
.rba-toast-success{background:#D5F5E3;color:#1a6e35}
.rba-toast-error{background:#FDEDEC;color:#b03a2e}
.rba-toast-info{background:#D6EAF8;color:#1a5276}
@keyframes rba-fadein{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
#rba-panel ::-webkit-scrollbar{width:5px}
#rba-panel ::-webkit-scrollbar-track{background:transparent}
#rba-panel ::-webkit-scrollbar-thumb{background:#d5dde5;border-radius:3px}
#rba-panel ::-webkit-scrollbar-thumb:hover{background:#bcc7d2}
.rba-collapsed .rba-header{border-radius:0 0 0 12px;writing-mode:vertical-lr;padding:18px 12px;font-size:14px;cursor:pointer;width:34px;letter-spacing:2px}
.rba-collapsed .rba-header .rba-header-site{display:none}
.rba-collapsed .rba-close{display:none}
`;

  // ===== SPA 路由监听 =====
  let lastUrl = window.location.href, urlCheckTimer = null;
  function onUrlChange() {
    const now = window.location.href;
    if (now === lastUrl) return;
    lastUrl = now;
    clearTimeout(urlCheckTimer);
    urlCheckTimer = setTimeout(() => { if (panelVisible && panelEl) { refreshPanelData(); toast('页面已切换，岗位列表已刷新', 'info'); } }, 800);
  }
  const _pushState = history.pushState;
  history.pushState = function (...args) { _pushState.apply(this, args); onUrlChange(); };
  const _replaceState = history.replaceState;
  history.replaceState = function (...args) { _replaceState.apply(this, args); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);
  setInterval(() => { if (window.location.href !== lastUrl) onUrlChange(); }, 800);

  // ===== 初始加载 =====
  setTimeout(() => { const ad = getAdapter(); if (ad && ad.isSearchPage()) { chrome.runtime.sendMessage({ type: 'pageReady', siteName: ad.name, isSearchPage: true }).catch(() => {}); } }, 1000);
  console.log('[一键投递] 已加载，站点:', getAdapter()?.name || '未识别');
})();
