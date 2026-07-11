/**
 * 内容脚本入口 — 注入招聘网站，负责：解析岗位、投递执行、侧边栏面板
 */
(function () {
  'use strict';

  // ===== 状态 =====
  let isApplying = false, stopRequested = false, applyQueue = [];
  let panelVisible = false;
  let allJobs = [], filteredJobs = [], selectedIds = new Set();
  let pendingCrawlJobs = null; // 投递中收到的爬取结果暂存
  let currentSiteName = '';
  let jobElementMap = new Map();

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
      case 'stopCrawl': { crawlStopSignal.stopped = true; sendResp({ success: true }); return; }
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
    const siteName = (ad && ad.name) || currentSiteName || '';
    chrome.runtime.sendMessage({ type: 'applyComplete', total, completed: done, successCount: results.filter(r => r.success).length, failCount: results.filter(r => !r.success).length, results, siteName }).catch(() => {});
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ===== 多页爬取 =====
  let crawlStopSignal = { stopped: false };
  async function crawlAllPagesAsync(ad, maxPages) {
    crawlStopSignal = { stopped: false };
    try {
      const all = await ad.crawlAllPages(window.location.href, maxPages, (cur, tot) => {
        chrome.runtime.sendMessage({ type: 'crawlProgress', currentPage: cur, totalPages: tot }).catch(() => {});
      }, crawlStopSignal);
      const stopped = crawlStopSignal.stopped;
      chrome.runtime.sendMessage({ type: 'crawlComplete', stopped, totalJobs: all.length, jobs: stopped ? [] : all.map(j => ({
        id: j.id, title: j.title, company: j.company, url: j.url || '', companyUrl: j.companyUrl || '',
        salary: j.salary, location: j.location, date: j.date, companyType: j.companyType,
        jobType: j.jobType, education: j.education || 'none', risk: j.risk || { level: 'low', score: 0, reasons: [] }, tags: j.tags
      })) }).catch(() => {});
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
      if (panelVisible) { panelEl.classList.remove('rba-collapsed'); setPageMargin(true); refreshPanelData(); startSpaPoll(); }
      else { panelEl.classList.add('rba-collapsed'); setPageMargin(false); stopSpaPoll(); }
    } else {
      createPanel(); panelVisible = true;
      panelEl.classList.remove('rba-collapsed'); setPageMargin(true); refreshPanelData(); startSpaPoll();
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
    ['filterDate','filterCompanyType','filterEducation','filterRisk'].forEach(id => { $(`#${id}`).addEventListener('change', () => { applyFilters(); saveFilters(); }); });
    // 全选/反选
    $('.rba-btn-selectall').addEventListener('click', () => { filteredJobs.forEach(j => selectedIds.add(j.id)); renderJobList(); updateJobCount(); });
    $('.rba-btn-invert').addEventListener('click', () => { const s = new Set(); filteredJobs.forEach(j => { if (!selectedIds.has(j.id)) s.add(j.id); }); selectedIds = s; renderJobList(); updateJobCount(); });
    // AI 模块
    $('.rba-ai-toggle').addEventListener('click', () => { $('.rba-ai-toggle').classList.toggle('collapsed'); $('.rba-ai-panel').classList.toggle('collapsed'); });
    $('#aiProvider').addEventListener('change', () => {
      const v = $('#aiProvider').value;
      $('#aiEndpointRow').style.display = v === 'custom' ? 'flex' : 'none';
      if (v === 'deepseek') $('#aiEndpoint').value = '';
      else if (v === 'openai') $('#aiEndpoint').value = '';
      if (v === 'deepseek') $('#aiModel').value = 'deepseek-chat';
      else if (v === 'openai') $('#aiModel').value = 'gpt-4o-mini';
      else $('#aiModel').value = '';
      saveAiConfig();
    });
    $('#aiEndpoint').addEventListener('input', saveAiConfig);
    $('#aiModel').addEventListener('input', saveAiConfig);
    $('#aiKey').addEventListener('input', saveAiConfig);
    $('#aiResume').addEventListener('input', saveAiConfig);
    $('#btnAiAnalyze').addEventListener('click', runAiAnalysis);

    // 爬取
    $('.rba-btn-crawl').addEventListener('click', startCrawl);
    $('.rba-btn-refresh').addEventListener('click', refreshPanelData);
    $('.rba-btn-stopcrawl').addEventListener('click', () => { crawlStopSignal.stopped = true; toast('正在停止爬取...', 'info'); });
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
    await loadAiConfig();
    try {
      jobElementMap.clear();
      const raw = ad.parseSearchResults();
      allJobs = raw.map(j => {
        if (j.element) jobElementMap.set(j.id, j.element);
        const risk = ad._assessJobRisk ? ad._assessJobRisk(j) : { level: 'low', score: 0, reasons: [] };
        return { id: j.id, title: j.title, company: j.company, url: j.url || '', companyUrl: j.companyUrl || '', salary: j.salary, location: j.location, date: j.date, companyType: j.companyType, jobType: j.jobType, education: j.education || 'none', risk, tags: j.tags };
      });
    } catch (e) { allJobs = []; jobElementMap.clear(); }
    selectedIds.clear(); applyFilters();
    // 自动触发 AI 分析
    autoAiAnalyze();
  }

  // ===== 筛选 =====
  function applyFilters() {
    const df = panelEl.querySelector('#filterDate').value;
    const cf = panelEl.querySelector('#filterCompanyType').value;
    const ef = panelEl.querySelector('#filterEducation').value;
    const rf = panelEl.querySelector('#filterRisk').value;
    filteredJobs = allJobs.filter(job => {
      if (df !== 'all' && job.dateObj) { const days = (Date.now() - job.dateObj.getTime()) / 86400000; if (days > parseInt(df)) return false; }
      if (cf !== 'all' && job.companyType !== cf) return false;
      if (ef !== 'all') { const lv = { none: 0, associate: 1, bachelor: 2, master: 3, doctor: 4 }; if ((lv[job.education] || 0) > (lv[ef] || 0)) return false; }
      if (rf !== 'all') { const jr = (job.risk && job.risk.level) || 'low'; if (jr !== rf) return false; }
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
      const risk = j.risk || { level: 'low', score: 0, reasons: [] };
      const aiTag = risk.ai ? '·AI' : '';
      let riskLabel;
      if (risk.level === 'analyzing') riskLabel = '🔄 分析中';
      else if (risk.level === 'high') riskLabel = `⚠ 高风险${aiTag}`;
      else if (risk.level === 'medium') riskLabel = `⚡ 中风险${aiTag}`;
      else riskLabel = `✓ 低风险${aiTag}`;
      const riskBadge = `<span class="rba-risk rba-risk-${risk.level}" title="${esc((risk.reasons||[]).join('; ') || '未检测到风险')}">${riskLabel}</span>`;
      let matchBadge = '';
      if (j.matchScore !== undefined) {
        const ms = j.matchScore;
        const mTitle = esc((j.matchReasons||[]).join('; '));
        if (ms >= 70) matchBadge = `<span class="rba-match rba-match-high" title="${mTitle}">🎯 ${ms}%</span>`;
        else if (ms >= 40) matchBadge = `<span class="rba-match rba-match-mid" title="${mTitle}">🎯 ${ms}%</span>`;
        else matchBadge = `<span class="rba-match rba-match-low" title="${mTitle}">🎯 ${ms}%</span>`;
      }
      return `<div class="rba-jobitem" data-id="${esc(j.id)}">
        <input type="checkbox" class="rba-cb" data-id="${esc(j.id)}" ${chk}>
        <div class="rba-jobinfo">
          <div class="rba-jobtitle ${hasUrl?'rba-link':''}" ${hasUrl?`data-url="${esc(j.url)}" title="点击在新标签页打开详情"`:''}>${esc(j.title)}${hasUrl?'<span class="rba-linkicon">↗</span>':''}${riskBadge}${matchBadge}</div>
          <div class="rba-jobcompany">${j.companyUrl ? `<a href="${j.companyUrl.replace(/"/g,'&quot;')}" target="_blank" class="rba-link" title="打开公司主页">${esc(j.company)}</a>` : esc(j.company)}${j.salary?' · '+esc(j.salary):''}</div>
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
    freezeUI(true);
    panelEl.querySelector('.rba-btn-crawl').disabled = true; panelEl.querySelector('.rba-btn-crawl').textContent = '爬取中...';
    panelEl.querySelector('.rba-crawlprogress').classList.remove('hidden'); panelEl.querySelector('.rba-btn-stopcrawl').classList.remove('hidden');
    crawlAllPagesAsync(ad, Math.min(max, 50));
  }
  function resetCrawlUI() { freezeUI(false); const b = panelEl.querySelector('.rba-btn-crawl'); b.disabled = false; b.textContent = '深度爬取'; panelEl.querySelector('.rba-crawlprogress').classList.add('hidden'); panelEl.querySelector('.rba-btn-stopcrawl').classList.add('hidden'); }
  function freezeUI(on) {
    const sel = panelEl.querySelectorAll('select, .rba-btn-apply, .rba-btn-schedule, .rba-btn-refresh, .rba-btn-selectall, .rba-btn-invert');
    sel.forEach(el => { el.disabled = on; el.style.opacity = on ? '0.4' : ''; });
  }

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
      case 'applyComplete': isApplying = false; updateApplyUI(false); updateProgress(msg.total, msg.total); toast(`投递完成！成功 ${msg.successCount}，失败 ${msg.failCount}`, msg.failCount ? 'info' : 'success'); if (pendingCrawlJobs) { allJobs = pendingCrawlJobs; pendingCrawlJobs = null; selectedIds.clear(); applyFilters(); toast(`已加载暂存结果：${allJobs.length} 个岗位`, 'success'); } break;
      case 'applyStopped': isApplying = false; updateApplyUI(false); break;
      case 'crawlProgress': panelEl.querySelector('.rba-crawltext').textContent = `爬取第 ${msg.currentPage}/${msg.totalPages} 页...`; break;
      case 'crawlComplete': resetCrawlUI(); if (msg.stopped) { toast('爬取已停止', 'info'); return; } if (msg.error) { toast('出错：'+msg.error, 'error'); return; } if (isApplying) { pendingCrawlJobs = msg.jobs; toast('投递进行中，结果已暂存', 'info'); return; } allJobs = msg.jobs || []; selectedIds.clear(); applyFilters(); toast(`深度爬取完成！共 ${allJobs.length} 个岗位`, 'success'); break;
    }
  }
  function updateProgress(cur, tot) { if (!tot) { panelEl.querySelector('.rba-progress').classList.add('hidden'); return; } panelEl.querySelector('.rba-progress').classList.remove('hidden'); panelEl.querySelector('.rba-bar').style.width = Math.round(cur/tot*100)+'%'; panelEl.querySelector('.rba-progresstext').textContent = `${cur}/${tot}`; }
  function updateApplyUI(on) { panelEl.querySelector('.rba-btn-apply').disabled = on; panelEl.querySelector('.rba-btn-apply').textContent = on ? '投递中...' : '立即投递'; panelEl.querySelector('.rba-btn-schedule').disabled = on; panelEl.querySelector('.rba-btn-stop').classList.toggle('hidden', !on); if (on) panelEl.querySelector('.rba-progress').classList.remove('hidden'); }

  // ===== AI 配置与执行 =====
  async function saveAiConfig() {
    const d = { provider: panelEl.querySelector('#aiProvider').value, endpoint: panelEl.querySelector('#aiEndpoint').value, model: panelEl.querySelector('#aiModel').value, key: panelEl.querySelector('#aiKey').value, resume: panelEl.querySelector('#aiResume').value };
    await chrome.storage.local.set({ aiConfig: d }).catch(() => {});
  }
  async function loadAiConfig() {
    try { const r = await chrome.storage.local.get('aiConfig'); const d = r.aiConfig; if (!d) return; if (d.provider) panelEl.querySelector('#aiProvider').value = d.provider; if (d.endpoint) panelEl.querySelector('#aiEndpoint').value = d.endpoint; if (d.model) panelEl.querySelector('#aiModel').value = d.model; if (d.key) panelEl.querySelector('#aiKey').value = d.key; if (d.resume) panelEl.querySelector('#aiResume').value = d.resume; panelEl.querySelector('#aiEndpointRow').style.display = panelEl.querySelector('#aiProvider').value === 'custom' ? 'flex' : 'none'; } catch (e) {}
  }

  // 自动 AI（面板打开时触发，不阻塞 UI）
  async function autoAiAnalyze() {
    try {
      const r = await chrome.storage.local.get('aiConfig');
      const cfg = r.aiConfig;
      if (!cfg || !cfg.key || !allJobs.length) return;
      // 标记所有岗位为"分析中"
      allJobs.forEach(j => { j.risk = { level: 'analyzing', score: 0, reasons: ['AI分析中...'], ai: true }; });
      applyFilters();
      // 直接调 runAiAnalysis
      await runAiAnalysis();
    } catch (e) { /* 静默 */ }
  }

  async function runAiAnalysis() {
    const key = panelEl.querySelector('#aiKey').value.trim();
    if (!key) return toast('请先填入 API Key', 'info');
    if (!allJobs.length) return toast('没有岗位数据，请先刷新或爬取', 'info');

    const btn = panelEl.querySelector('#btnAiAnalyze'); const st = panelEl.querySelector('#aiStatus');
    btn.disabled = true; st.textContent = '分析中...';

    const provider = panelEl.querySelector('#aiProvider').value;
    let endpoint = panelEl.querySelector('#aiEndpoint').value.trim();
    const model = panelEl.querySelector('#aiModel').value.trim();

    if (!endpoint) {
      if (provider === 'deepseek') endpoint = 'https://api.deepseek.com/chat/completions';
      else if (provider === 'openai') endpoint = 'https://api.openai.com/v1/chat/completions';
    }
    const finalModel = model || (provider === 'deepseek' ? 'deepseek-chat' : provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat');

    const MAX_AI_JOBS = 10;
    if (allJobs.length > MAX_AI_JOBS) { toast(`岗位较多，AI 仅分析前 ${MAX_AI_JOBS} 个（共 ${allJobs.length} 个）`, 'info'); }
    const resumeText = panelEl.querySelector('#aiResume').value.trim();
    const sample = allJobs.slice(0, MAX_AI_JOBS).map(j => ({ id: j.id, title: j.title, company: j.company, salary: j.salary, companyType: j.companyType }));
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'aiAnalyze', jobs: sample, config: { endpoint, model: finalModel, key }, resume: resumeText || undefined });
      if (!resp || resp.error) { st.textContent = resp?.error || '请求失败'; btn.disabled = false; return; }
      let updated = 0;
      for (const r of (resp.results || [])) {
        const job = allJobs.find(j => j.id === r.id);
        if (job) {
          if (r.risk) job.risk = { level: r.risk.level || 'low', score: r.risk.score || 0, reasons: r.risk.reasons || [], ai: true };
          if (r.companyType && r.companyType !== 'unknown') job.companyType = r.companyType;
          if (r.matchScore !== undefined) job.matchScore = r.matchScore;
          if (r.matchReasons) job.matchReasons = r.matchReasons;
          updated++;
        }
      }
      applyFilters();
      st.textContent = `完成，更新 ${updated} 个岗位`;
      toast(`AI 分析完成：更新了 ${updated} 个岗位的风险和公司类型`, 'success');
    } catch (e) { st.textContent = '请求失败: ' + e.message; }
    btn.disabled = false;
  }
  async function saveFilters() { const d = { filterDate: panelEl.querySelector('#filterDate').value, filterCompanyType: panelEl.querySelector('#filterCompanyType').value, filterEducation: panelEl.querySelector('#filterEducation').value, filterRisk: panelEl.querySelector('#filterRisk').value, filterCollapsed: panelEl.querySelector('.rba-filter-toggle').classList.contains('collapsed') }; await chrome.storage.local.set({ popupFilters: d }).catch(() => {}); }
  async function loadFilters() { try { const r = await chrome.storage.local.get('popupFilters'); const d = r.popupFilters; if (!d) return; if (d.filterDate) panelEl.querySelector('#filterDate').value = d.filterDate; if (d.filterCompanyType) panelEl.querySelector('#filterCompanyType').value = d.filterCompanyType; if (d.filterEducation) panelEl.querySelector('#filterEducation').value = d.filterEducation; if (d.filterRisk) panelEl.querySelector('#filterRisk').value = d.filterRisk; if (d.filterCollapsed) { panelEl.querySelector('.rba-filter-toggle').classList.add('collapsed'); panelEl.querySelector('.rba-filter-panel').classList.add('collapsed'); } } catch (e) {} }

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
    <div class="rba-filter-wrap">
      <div class="rba-filter-section">
        <div class="rba-filter-toggle"><span class="rba-arrow">▼</span> 筛选条件</div>
        <div class="rba-filter-panel">
          <div class="rba-frow"><label>发布日期</label><select id="filterDate"><option value="all">不限</option><option value="1">24小时内</option><option value="3">3天内</option><option value="7">7天内</option><option value="14">14天内</option><option value="30">30天内</option></select></div>
          <div class="rba-frow"><label>公司类型</label><select id="filterCompanyType"><option value="all">不限</option><option value="listed">上市公司</option><option value="state">国企/央企</option><option value="foreign">外企</option><option value="private">民营企业</option><option value="startup">创业公司</option></select></div>
          <div class="rba-frow"><label>学历要求</label><select id="filterEducation"><option value="all">不限</option><option value="none">学历不限</option><option value="associate">大专及以上</option><option value="bachelor">本科及以上</option><option value="master">硕士及以上</option><option value="doctor">博士</option></select></div>
          <div class="rba-frow"><label>风险等级</label><select id="filterRisk"><option value="all">不限</option><option value="high">⚠ 高风险</option><option value="medium">⚡ 中风险</option><option value="low">✓ 低风险</option><option value="analyzing">🔄 分析中</option></select></div>
        </div>
      </div>
    </div>
    <div class="rba-ai-wrap">
      <div class="rba-ai-section">
        <div class="rba-ai-toggle"><span class="rba-arrow">▼</span> AI 分析</div>
        <div class="rba-ai-panel collapsed">
          <div class="rba-frow"><label>API 提供商</label><select id="aiProvider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义</option></select></div>
          <div class="rba-frow" id="aiEndpointRow" style="display:none"><label>API 地址</label><input id="aiEndpoint" placeholder="https://api.openai.com/v1/chat/completions"></div>
          <div class="rba-frow"><label>模型名称</label><input id="aiModel" placeholder="deepseek-chat"></div>
          <div class="rba-frow"><label>API Key</label><input id="aiKey" type="password" placeholder="sk-..."></div>
          <div class="rba-frow" style="flex-direction:column;align-items:stretch"><label style="margin-bottom:4px">📄 我的简历</label><textarea id="aiResume" rows="4" placeholder="粘贴简历文本，AI 将分析岗位与简历的匹配度（可选）" style="width:100%;padding:6px 8px;border:1px solid #d1d1d1;border-radius:4px;font-size:12px;resize:vertical;font-family:inherit"></textarea></div>
          <div class="rba-ai-actions">
            <button class="rba-btn-ai-analyze" id="btnAiAnalyze">🤖 AI 分析当前岗位</button>
            <span class="rba-ai-status" id="aiStatus"></span>
          </div>
        </div>
      </div>
    </div>
    <div class="rba-crawl-wrap">
      <div class="rba-crawltool">
        <select id="crawlPages"><option value="1">仅当前页</option><option value="3">爬取 3 页</option><option value="5" selected>爬取 5 页</option><option value="10">爬取 10 页</option><option value="20">爬取 20 页</option></select>
        <button class="rba-btn-crawl">深度爬取</button>
        <button class="rba-btn-refresh">刷新</button>
        <div class="rba-crawlprogress hidden"><span class="rba-crawltext">爬取第 1/5 页...</span><button class="rba-btn-stopcrawl hidden">停止</button></div>
      </div>
    </div>
    <div class="rba-list-wrap">
      <div class="rba-listheader"><span class="rba-jobcount">0 个岗位</span><div><button class="rba-btn-selectall">全选</button><button class="rba-btn-invert">反选</button></div></div>
      <div class="rba-joblist"><div class="rba-empty">打开招聘网站搜索结果页</div></div>
    </div>
    <div class="rba-progress hidden"><div class="rba-barwrap"><div class="rba-bar" style="width:0%"></div></div><div class="rba-progresstext">0/0</div></div>
    <div class="rba-actions-wrap">
      <div class="rba-actions">
        <button class="rba-btn-apply">立即投递</button><button class="rba-btn-schedule">定时投递</button>
        <button class="rba-btn-stop hidden">停止投递</button>
      </div>
    </div>
  </div>
  <div class="rba-modal hidden"><div class="rba-modalbox"><h3>设定投递时间</h3><input type="datetime-local" id="scheduleTime"><p class="rba-hint">到设定时间后，自动在当前页面投递已选岗位</p><div class="rba-modalfoot"><button class="rba-modal-cancel">取消</button><button class="rba-modal-confirm">确认定时</button></div></div></div>
  <div class="rba-toast hidden"></div>`;

  const PANEL_CSS = `
#rba-panel{position:fixed;top:0;right:0;width:clamp(390px,35vw,520px);height:100vh;background:#fafafa;border-left:1px solid #e8e8e8;z-index:2147483646;font:13px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;color:#1a1a1a;display:flex;flex-direction:column;overflow:hidden;user-select:none;transition:transform .2s ease}
#rba-panel.rba-collapsed{transform:translateX(98%)}
#rba-panel *{box-sizing:border-box;margin:0;padding:0}
#rba-panel button,#rba-panel select{font-family:inherit}

.rba-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff;color:#1a1a1a;font-size:15px;font-weight:600;flex-shrink:0;gap:8px;border-bottom:1px solid #e8e8e8}
.rba-header-site{font-size:11px;font-weight:400;color:#616161;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rba-loginstatus.rba-ok{color:#107c10}
.rba-loginstatus.rba-warn{color:#c00}
.rba-close{background:none;border:none;color:#616161;font-size:18px;cursor:pointer;padding:4px 8px;line-height:1;flex-shrink:0;border-radius:4px}
.rba-close:hover{background:#f0f0f0;color:#1a1a1a}

.rba-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.rba-filter-wrap{flex-shrink:0;z-index:2;background:#fafafa;padding:10px 16px 0}
.rba-ai-wrap{flex-shrink:0;z-index:2;background:#fafafa;padding:0 16px}
.rba-ai-section{background:#fff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin-bottom:8px}
.rba-ai-toggle{padding:10px 14px;cursor:pointer;font-size:12px;font-weight:500;color:#1a1a1a;background:#fff;display:flex;align-items:center;gap:6px;border-bottom:1px solid #e8e8e8}
.rba-ai-toggle:hover{background:#f5f5f5}
.rba-ai-toggle.collapsed{border-bottom:none}
.rba-ai-toggle.collapsed .rba-arrow{transform:rotate(-90deg)}
.rba-ai-panel{padding:8px 14px 12px;background:#fff}
.rba-ai-panel.collapsed{display:none}
.rba-ai-panel input{flex:1;padding:6px 8px;border:1px solid #d1d1d1;border-radius:4px;font-size:12px;color:#1a1a1a;outline:none;background:#fff}
.rba-ai-panel input:focus{border-color:#0078D4;box-shadow:0 0 0 1px #0078D4}
.rba-ai-actions{display:flex;align-items:center;gap:10px;margin-top:10px}
.rba-btn-ai-analyze{background:#0078D4;color:#fff;border:none;padding:7px 16px;border-radius:4px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.rba-btn-ai-analyze:hover:not(:disabled){background:#106ebe}
.rba-btn-ai-analyze:disabled{background:#ccc;cursor:not-allowed}
.rba-ai-status{font-size:11px;color:#616161}

.rba-crawl-wrap{flex-shrink:0;z-index:2;background:#fafafa;padding:8px 16px 4px}
.rba-actions-wrap{flex-shrink:0;z-index:2;background:#fafafa;padding:12px 16px;border-top:1px solid #e8e8e8}

.rba-filter-section{background:#fff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden}
.rba-filter-toggle{padding:10px 14px;cursor:pointer;font-size:12px;font-weight:500;color:#1a1a1a;background:#fff;display:flex;align-items:center;gap:6px}
.rba-filter-toggle:hover{background:#f5f5f5}
.rba-arrow{font-size:10px;transition:.15s;color:#888}
.rba-filter-toggle.collapsed .rba-arrow{transform:rotate(-90deg)}
.rba-filter-panel{padding:4px 14px 12px;background:#fff}
.rba-filter-panel.collapsed{display:none}
.rba-frow{display:flex;align-items:center;gap:8px;margin-top:8px}
.rba-frow label{width:60px;font-size:12px;color:#616161;flex-shrink:0}
.rba-frow select{flex:1;padding:6px 8px;border:1px solid #d1d1d1;border-radius:4px;font-size:12px;color:#1a1a1a;outline:none;background:#fff;cursor:pointer}
.rba-frow select:focus{border-color:#0078D4;box-shadow:0 0 0 1px #0078D4}

.rba-crawltool{padding:6px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rba-crawltool select{padding:6px 8px;border:1px solid #d1d1d1;border-radius:4px;font-size:12px;outline:none;cursor:pointer;background:#fff}
.rba-crawltool select:focus{border-color:#0078D4}
.rba-crawltool button{padding:6px 12px;border-radius:4px;font-size:12px;cursor:pointer;border:none;font-weight:500;white-space:nowrap}
.rba-btn-crawl{background:#0078D4;color:#fff}
.rba-btn-crawl:hover:not(:disabled){background:#106ebe}
.rba-btn-crawl:disabled{opacity:.5;cursor:not-allowed;background:#ccc}
.rba-btn-refresh{background:#fff;color:#1a1a1a;border:1px solid #d1d1d1!important}
.rba-btn-refresh:hover{background:#f5f5f5}
.rba-crawlprogress{width:100%;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#0078D4;margin-top:4px}
.rba-btn-stopcrawl{background:none!important;border:none!important;color:#c00;cursor:pointer;font-size:11px;padding:0!important}
.rba-btn-stopcrawl:hover{text-decoration:underline}
.rba-crawlprogress.hidden,.rba-progress.hidden,.rba-modal.hidden,.rba-toast.hidden,.rba-collapsed .rba-body{display:none!important}

.rba-list-wrap{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;margin:0 16px}
.rba-listheader{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;color:#616161;flex-shrink:0}
.rba-jobcount{font-weight:500;color:#1a1a1a}
.rba-listheader button{background:none;border:none;color:#0078D4;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:4px}
.rba-listheader button:hover{background:#f0f6fc}

.rba-joblist{flex:1;overflow-y:auto;min-height:0;background:#fff;border:1px solid #e8e8e8;border-radius:8px}
.rba-empty{padding:36px 16px;text-align:center;color:#999;font-size:12px}
.rba-jobitem{display:flex;align-items:flex-start;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f3f3f3;transition:background .1s}
.rba-jobitem:last-child{border-bottom:none}
.rba-jobitem:hover{background:#fafafa}
.rba-cb{width:16px;height:16px;min-width:16px;margin-right:10px;margin-top:2px;cursor:pointer;accent-color:#0078D4;flex-shrink:0}
.rba-jobinfo{flex:1;min-width:0}
.rba-jobtitle{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;color:#1a1a1a}
.rba-link{color:#0078D4;cursor:pointer}
.rba-link:hover{text-decoration:underline;color:#106ebe}
.rba-linkicon{font-size:10px;margin-left:2px;opacity:0;transition:.15s}
.rba-link:hover .rba-linkicon{opacity:1}
.rba-jobcompany{font-size:12px;color:#616161;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rba-jobmeta{font-size:11px;color:#888;display:flex;gap:5px;flex-wrap:wrap;margin-top:3px;align-items:center}
.rba-jobmeta span{background:#f3f3f3;padding:1px 7px;border-radius:2px;white-space:nowrap}

.rba-risk{font-size:10px;padding:1px 6px;border-radius:2px;margin-left:6px;font-weight:500;vertical-align:middle}
.rba-risk-high{background:#fde7e9;color:#c00;border:1px solid #f5c6cb}
.rba-risk-medium{background:#fff4ce;color:#8a6d14;border:1px solid #ffeaa7}
.rba-risk-low{background:#dff6dd;color:#1e5200;border:1px solid #b7dfb9}
.rba-risk-analyzing{background:#deecf9;color:#004578;border:1px solid #b3d4f0;animation:rba-pulse 1.5s infinite}
@keyframes rba-pulse{0%,100%{opacity:1}50%{opacity:.5}}

.rba-match{font-size:10px;padding:1px 6px;border-radius:2px;margin-left:4px;font-weight:600}
.rba-match-high{background:#dff6dd;color:#1e5200}
.rba-match-mid{background:#fff4ce;color:#8a6d14}
.rba-match-low{background:#fde7e9;color:#c00}

.rba-progress{padding:6px 0;flex-shrink:0;margin:0 12px}
.rba-barwrap{height:4px;background:#e8e8e8;border-radius:2px;overflow:hidden}
.rba-bar{height:100%;background:#0078D4;border-radius:2px;transition:width .3s}
.rba-progresstext{text-align:center;font-size:11px;color:#888;margin-top:4px}

.rba-actions{display:flex;gap:8px;padding:10px 0;flex-wrap:wrap}
.rba-actions button{padding:10px 0;border-radius:6px;font-size:14px;cursor:pointer;border:none;font-weight:500;flex:1;min-width:100px}
.rba-actions button:active{transform:scale(.98)}
.rba-btn-apply{background:#0078D4;color:#fff}
.rba-btn-apply:hover:not(:disabled){background:#106ebe}
.rba-btn-apply:disabled{background:#ccc;cursor:not-allowed;transform:none}
.rba-btn-schedule{background:#fff;color:#1a1a1a;border:1px solid #d1d1d1!important}
.rba-btn-schedule:hover:not(:disabled){background:#f5f5f5;border-color:#0078D4!important}
.rba-btn-schedule:disabled{opacity:.4;cursor:not-allowed}
.rba-btn-stop{background:#c00!important;color:#fff!important;flex:3 0 100%!important}
.rba-btn-stop:hover:not(:disabled){background:#a00!important}

.rba-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.35);z-index:2147483647;display:flex;align-items:center;justify-content:center}
.rba-modalbox{background:#fff;border-radius:8px;padding:24px;width:340px;box-shadow:0 8px 24px rgba(0,0,0,.15)}
.rba-modalbox h3{font-size:15px;font-weight:600;margin-bottom:14px;color:#1a1a1a}
.rba-modalbox input{width:100%;padding:8px 10px;border:1px solid #d1d1d1;border-radius:4px;font-size:13px;margin-bottom:10px;outline:none}
.rba-modalbox input:focus{border-color:#0078D4;box-shadow:0 0 0 1px #0078D4}
.rba-hint{font-size:12px;color:#888;margin-bottom:16px}
.rba-modalfoot{display:flex;justify-content:flex-end;gap:8px}
.rba-modal-cancel,.rba-modal-confirm{padding:8px 20px;border-radius:4px;font-size:13px;cursor:pointer;border:none;font-weight:500}
.rba-modal-cancel{background:#f0f0f0;color:#1a1a1a}
.rba-modal-cancel:hover{background:#e0e0e0}
.rba-modal-confirm{background:#0078D4;color:#fff}
.rba-modal-confirm:hover{background:#106ebe}

.rba-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:6px;font-size:12px;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,.12);animation:rba-fadein .25s;pointer-events:none;max-width:480px}
.rba-toast-success{background:#dff6dd;color:#1e5200}
.rba-toast-error{background:#fde7e9;color:#8b0000}
.rba-toast-info{background:#deecf9;color:#004578}
@keyframes rba-fadein{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

#rba-panel ::-webkit-scrollbar{width:5px}
#rba-panel ::-webkit-scrollbar-track{background:transparent}
#rba-panel ::-webkit-scrollbar-thumb{background:#d1d1d1;border-radius:3px}
#rba-panel ::-webkit-scrollbar-thumb:hover{background:#a0a0a0}

.rba-collapsed .rba-header{border-radius:0 0 0 8px;writing-mode:vertical-lr;padding:14px 8px;font-size:13px;cursor:pointer;width:30px;letter-spacing:1px;border:1px solid #e8e8e8;border-right:none}
.rba-collapsed .rba-header .rba-header-site{display:none}
.rba-collapsed .rba-close{display:none}
`;

  // ===== SPA 路由监听 =====
  let lastUrl = window.location.href, urlCheckTimer = null, spaPollTimer = null;
  function onUrlChange() {
    const now = window.location.href;
    if (now === lastUrl) return;
    lastUrl = now;
    clearTimeout(urlCheckTimer);
    urlCheckTimer = setTimeout(() => { if (panelVisible && panelEl) { refreshPanelData(); toast('页面已切换，岗位列表已刷新', 'info'); } }, 800);
  }
  function startSpaPoll() { if (!spaPollTimer) spaPollTimer = setInterval(() => { if (window.location.href !== lastUrl) onUrlChange(); }, 1000); }
  function stopSpaPoll() { clearInterval(spaPollTimer); spaPollTimer = null; }
  const _pushState = history.pushState;
  history.pushState = function (...args) { _pushState.apply(this, args); onUrlChange(); };
  const _replaceState = history.replaceState;
  history.replaceState = function (...args) { _replaceState.apply(this, args); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);

  // ===== 初始加载 =====
  setTimeout(() => { const ad = getAdapter(); if (ad && ad.isSearchPage()) { chrome.runtime.sendMessage({ type: 'pageReady', siteName: ad.name, isSearchPage: true }).catch(() => {}); } }, 1000);
  console.log('[一键投递] 已加载，站点:', getAdapter()?.name || '未识别');
})();
