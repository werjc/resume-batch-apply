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
  let jobElementMap = new Map();
  let seenJobIds = new Set(); // 瀑布流去重

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
    }
    return true;
  });

  // ===== 批量投递（基于元素直接操作） =====
  async function executeApply(ad) {
    const total = applyQueue.length; let done = 0; const results = [];
    const searchUrl = window.location.href;
    for (let i = 0; i < applyQueue.length; i++) {
      const id = applyQueue[i];
      if (stopRequested) { results.push({ jobId: id, success: false, message: '已停止' }); break; }
      const el = jobElementMap.get(id);
      if (!el) { results.push({ jobId: id, success: false, message: '未找到元素' }); done++; continue; }
      // 断点续投：每次投递前保存剩余队列
      const remaining = applyQueue.slice(i);
      await chrome.storage.local.set({ pendingQueue: remaining, pendingSearchUrl: searchUrl, pendingTotal: total, pendingDone: done, pendingResults: results, pendingSite: (ad && ad.name) || currentSiteName }).catch(() => {});
      try {
        const beforeUrl = window.location.href;
        const r = await ad.applyToPosition(el);
        results.push({ jobId: id, ...r });
        // 自动检测页面是否跳转了（不依赖适配器返回 navigating 标志）
        const urlChanged = window.location.href !== beforeUrl;
        if (r.navigating || urlChanged) break;
      } catch (e) {
        results.push({ jobId: id, success: false, message: e.message });
      }
      done++;
      chrome.runtime.sendMessage({ type: 'applyProgress', current: done, total, jobId: id, lastResult: results[results.length - 1] }).catch(() => {});
      if (!stopRequested && done < total) await sleep(2000 + Math.random() * 2000);
    }
    // 正常结束（无跳转）→ 清除断点
    chrome.storage.local.remove(['pendingQueue','pendingSearchUrl','pendingTotal','pendingDone','pendingResults']).catch(() => {});
    // 投递完毕 — 记录已投成功的 ID
    const successIds = results.filter(r => r.success).map(r => r.jobId);
    if (successIds.length) {
      chrome.storage.local.get('appliedJobIds').then(({ appliedJobIds }) => {
        const ids = appliedJobIds || [];
        for (const id of successIds) { if (!ids.includes(id)) ids.push(id); }
        if (ids.length > 500) ids.splice(0, ids.length - 500);
        chrome.storage.local.set({ appliedJobIds: ids });
      }).catch(() => {});
      // 同步标记到当前岗位数据
      for (const job of allJobs) { if (successIds.includes(job.id)) job.applied = true; }
      applyFilters();
    }
    isApplying = false;
    const siteName = (ad && ad.name) || currentSiteName || '';
    chrome.runtime.sendMessage({ type: 'applyComplete', total, completed: done, successCount: results.filter(r => r.success).length, failCount: results.filter(r => !r.success).length, results, siteName }).catch(() => {});
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ===== 瀑布流监听 ====
  //  侧边栏面板
  // ============================================================
  let panelEl = null;

  function togglePanel() {
    if (panelEl) {
      panelVisible = !panelVisible;
      if (panelVisible) { panelEl.classList.remove('rba-collapsed'); setPageMargin(true); refreshPanelData(); startSpaPoll(); }
      else { panelEl.classList.add('rba-collapsed'); setPageMargin(false); stopSpaPoll(); stopWaterfallWatch(); }
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
    // 先清理可能存在的旧面板（防止多次调用产生重复DOM）
    const oldPanel = document.getElementById('rba-panel');
    if (oldPanel) oldPanel.remove();
    const oldStyle = document.getElementById('rba-panel-style');
    if (oldStyle) oldStyle.remove();
    const ad = getAdapter();
    currentSiteName = ad ? ad.name : '';
    const style = document.createElement('style');
    style.id = 'rba-panel-style';
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
    ['filterDate','filterCompanyType','filterEducation','filterRisk'].forEach(id => { $(`#${id}`).addEventListener('change', () => { saveFilters(); }); });
    $('.rba-btn-applyfilter').addEventListener('click', () => { applyFilters(); saveFilters(); toast('筛选已应用', 'info'); });
    // 全选/反选
    $('.rba-btn-selectall').addEventListener('click', () => { filteredJobs.forEach(j => { if (!j.applied) selectedIds.add(j.id); }); renderJobList(); updateJobCount(); });
    $('.rba-btn-invert').addEventListener('click', () => { const s = new Set(); filteredJobs.forEach(j => { if (!selectedIds.has(j.id) && !j.applied) s.add(j.id); }); selectedIds = s; renderJobList(); updateJobCount(); });
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
    $('#btnPdfUpload').addEventListener('click', () => $('#aiPdfInput').click());
    $('#aiPdfInput').addEventListener('change', handlePdfUpload);
    $('#btnAiAnalyze').addEventListener('click', runAiAnalysis);
    $('#btnDebugLog').addEventListener('click', showDebugLog);

    $('.rba-btn-refresh').addEventListener('click', refreshPanelData);
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

  // ===== 错误日志辅助 =====
  function logError(source, message, detail) {
    console.error('[一键投递]', source, message, detail);
    chrome.storage.local.get('errorLog').then(r => {
      const logs = r.errorLog || [];
      logs.unshift({ time: new Date().toISOString(), source, message, detail: detail ? String(detail).slice(0, 500) : '' });
      if (logs.length > 50) logs.length = 50;
      chrome.storage.local.set({ errorLog: logs });
    }).catch(() => {});
  }

  // ===== 数据刷新 =====
  async function refreshPanelData() {
    const ad = getAdapter();
    if (!ad) return;
    stopWaterfallWatch(); // 暂停瀑布流防止并发写入 allJobs
    try {
      const st = ad.checkLoginStatus();
      panelEl.querySelector('.rba-sitename').textContent = ad.name;
      panelEl.querySelector('.rba-loginstatus').textContent = st.loggedIn ? '已登录' : '未登录';
      panelEl.querySelector('.rba-loginstatus').className = 'rba-loginstatus ' + (st.loggedIn ? 'rba-ok' : 'rba-warn');
      await loadFilters();
      await loadAiConfig();
      const resumeText = panelEl.querySelector('#aiResume').value.trim();
      if (resumeText && resumeText.length > 20) {
        toast(`已加载简历 (${resumeText.length}字)`, 'info');
      }
      let appliedIds = [];
      try { const r = await chrome.storage.local.get('appliedJobIds'); appliedIds = r.appliedJobIds || []; } catch (e) {}
      jobElementMap.clear();
      seenJobIds.clear();
      const raw = ad.parseSearchResults();
      if (!raw || !raw.length) {
        panelEl.querySelector('.rba-joblist').innerHTML = '<div class="rba-empty">当前页面未解析到岗位，请确认在搜索结果页</div>';
        // 自动捕获页面 DOM 指纹，用于调试未知站点
        const fp = captureDomFingerprint();
        logError('parseSearchResults', '解析结果为空 — ' + ad.name, JSON.stringify(fp).slice(0, 500));
      }
      allJobs = raw.map(j => {
        if (j.element) jobElementMap.set(j.id, j.element);
        seenJobIds.add(j.id);
        const risk = ad._assessJobRisk ? ad._assessJobRisk(j) : { level: 'low', score: 0, reasons: [] };
        return { id: j.id, title: j.title, company: j.company, url: j.url || '', companyUrl: j.companyUrl || '', salary: j.salary, location: j.location, date: j.date, companyType: j.companyType, jobType: j.jobType, education: j.education || 'none', risk, tags: j.tags, applied: appliedIds.includes(j.id) };
      });
    } catch (e) {
      logError('refreshPanelData', '刷新数据失败', e.message);
    }
    // 防御：确保 allJobs 不会被重复累加（清掉同步可能产生的脏数据）
    allJobs.forEach(j => { delete j._rendered; });
    selectedIds.clear(); applyFilters();
    autoAiAnalyze();
    startWaterfallWatch();
  }

  // ===== 瀑布流监听 =====
  let waterfallObserver = null;
  let waterfallDebounce = null;

  function startWaterfallWatch() {
    if (!panelVisible) return; // 面板已关闭，不启动
    stopWaterfallWatch();
    waterfallObserver = new MutationObserver(() => {
      clearTimeout(waterfallDebounce);
      waterfallDebounce = setTimeout(syncNewJobs, 600);
    });
    waterfallObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopWaterfallWatch() {
    if (waterfallObserver) { waterfallObserver.disconnect(); waterfallObserver = null; }
    clearTimeout(waterfallDebounce);
  }

  async function syncNewJobs() {
    const ad = getAdapter();
    if (!ad) return;
    try {
      let appliedIds = [];
      try { const r = await chrome.storage.local.get('appliedJobIds'); appliedIds = r.appliedJobIds || []; } catch (e) {}
      const raw = ad.parseSearchResults();
      let added = 0;
      for (const j of raw) {
        if (seenJobIds.has(j.id)) continue;
        seenJobIds.add(j.id);
        if (j.element) jobElementMap.set(j.id, j.element);
        const risk = ad._assessJobRisk ? ad._assessJobRisk(j) : { level: 'low', score: 0, reasons: [] };
        allJobs.push({ id: j.id, title: j.title, company: j.company, url: j.url || '', companyUrl: j.companyUrl || '', salary: j.salary, location: j.location, date: j.date, companyType: j.companyType, jobType: j.jobType, education: j.education || 'none', risk, tags: j.tags, applied: appliedIds.includes(j.id) });
        added++;
      }
      if (added > 0) applyFilters();
    } catch (e) { logError('syncNewJobs', '瀑布流同步失败', e.message); }
  }

  // ===== 筛选 =====
  function applyFilters() {
    const df = panelEl.querySelector('#filterDate').value;
    const cf = panelEl.querySelector('#filterCompanyType').value;
    const ef = panelEl.querySelector('#filterEducation').value;
    const rf = panelEl.querySelector('#filterRisk').value;
    filteredJobs = allJobs.filter(job => {
      if (df !== 'all' && job.dateObj) { const days = (Date.now() - job.dateObj.getTime()) / 86400000; if (days > parseInt(df)) return false; }
      if (cf !== 'all' && job.companyType !== cf && job.companyType !== 'unknown') return false;
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
      const posStr = (risk.positives||[]).length ? ' · 👍' + esc(risk.positives.join('; ')) : '';
      const riskBadge = `<span class="rba-risk rba-risk-${risk.level}" title="${esc((risk.reasons||[]).join('; ') || '未检测到风险')}${posStr}">${riskLabel}</span>`;
      let matchBadge = '';
      if (j.matchScore !== undefined) {
        const ms = j.matchScore;
        const mTitle = esc((j.matchReasons||[]).join('; '));
        if (ms >= 70) matchBadge = `<span class="rba-match rba-match-high" title="${mTitle}">🎯 ${ms}%</span>`;
        else if (ms >= 40) matchBadge = `<span class="rba-match rba-match-mid" title="${mTitle}">🎯 ${ms}%</span>`;
        else matchBadge = `<span class="rba-match rba-match-low" title="${mTitle}">🎯 ${ms}%</span>`;
      }
      const appliedTag = j.applied ? '<span class="rba-applied" title="已投递过此岗位">✓ 已投</span>' : '';
      return `<div class="rba-jobitem${j.applied?' rba-applied-item':''}" data-id="${esc(j.id)}">
        <input type="checkbox" class="rba-cb" data-id="${esc(j.id)}" ${chk} ${j.applied?'disabled':''}>
        <div class="rba-jobinfo">
          <div class="rba-jobtitle ${hasUrl?'rba-link':''}" ${hasUrl?`data-url="${esc(j.url)}" title="点击在新标签页打开详情"`:''}>${esc(j.title)}${hasUrl?'<span class="rba-linkicon">↗</span>':''}${riskBadge}${matchBadge}${appliedTag}</div>
          <div class="rba-jobcompany">${j.companyUrl ? `<a href="${j.companyUrl.replace(/"/g,'&quot;')}" target="_blank" class="rba-link" title="打开公司主页">${esc(j.company)}</a>` : esc(j.company)}${j.salary?' · '+esc(j.salary):''}</div>
          <div class="rba-jobmeta">${j.education&&j.education!=='none'?`<span>${eduLabel(j.education)}</span>`:''}${j.jobType?`<span>${jobTypeLabel(j.jobType)}</span>`:''}${j.date?`<span>${esc(j.date)}</span>`:''}${j.location?`<span>${esc(j.location)}</span>`:''}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.rba-cb').forEach(cb => cb.addEventListener('change', e => { e.stopPropagation(); if (cb.disabled) return; cb.checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id); updateJobCount(); }));
    list.querySelectorAll('.rba-jobitem').forEach(item => item.addEventListener('click', e => { if (e.target.closest('.rba-link') || e.target.closest('.rba-cb')) return; const cb = item.querySelector('.rba-cb'); if (cb.disabled) return; cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }));
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
      // 只标记前 MAX_AI_JOBS 为分析中（与 runAiAnalysis 一致）
      const MAX_AI = 10;
      allJobs.slice(0, MAX_AI).forEach(j => { j.risk = { level: 'analyzing', score: 0, reasons: ['AI分析中...'], ai: true }; });
      applyFilters();
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

  async function showDebugLog() {
    try {
      const r = await chrome.storage.local.get('errorLog');
      const logs = r.errorLog || [];
      if (!logs.length) return toast('没有错误日志 ✓', 'success');
      const text = logs.map(l => `[${l.time.slice(5,16)}] ${l.source}: ${l.message}` + (l.detail ? `\n  detail: ${l.detail}` : '')).join('\n');
      // 复制到剪贴板
      await navigator.clipboard.writeText(text);
      toast(`已复制 ${logs.length} 条日志到剪贴板`, 'info');
    } catch (e) { toast('读取日志失败', 'error'); }
  }
  async function handlePdfUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    toast('正在提取 PDF 文本...', 'info');
    try {
      const buf = await file.arrayBuffer();
      const text = await extractPdfText(buf);
      if (text.trim().length > 10) {
        panelEl.querySelector('#aiResume').value = text.trim().slice(0, 8000);
        saveAiConfig();
        toast('PDF 文本已提取 (' + text.trim().length + ' 字符)', 'success');
      } else {
        toast('未能提取到文本，请尝试复制粘贴', 'error');
      }
    } catch (err) {
      toast('PDF 解析失败，请复制粘贴', 'error');
    }
    e.target.value = '';
  }

  async function extractPdfText(buf) {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB 限制
    if (buf.byteLength > MAX_SIZE) throw new Error('PDF 文件过大（最大10MB）');
    const bytes = new Uint8Array(buf);
    const raw = new TextDecoder('latin1').decode(bytes);
    const texts = [];

    // 尝试解压所有 FlateDecode 流
    const streamRe = /\/Filter\s*\/FlateDecode[^\n\r>]*>>\s*stream\s*\r?\n([\s\S]*?)endstream/gm;
    let match;
    while ((match = streamRe.exec(raw)) !== null) {
      try {
        const streamBytes = match[1];
        const compressed = new Uint8Array(streamBytes.length);
        for (let i = 0; i < streamBytes.length; i++) compressed[i] = streamBytes.charCodeAt(i) & 0xFF;
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(compressed);
        writer.close();
        let decompressed = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          decompressed += new TextDecoder().decode(value);
        }
        // 从解压后的内容提取 BT...ET 文本
        const btBlocks = decompressed.match(/BT[\s\S]*?ET/g);
        if (btBlocks) {
          for (const block of btBlocks) {
            // Tj 操作符: (text) Tj
            const tj = block.match(/\(([^)]*)\)\s*Tj/g);
            if (tj) {
              for (const t of tj) {
                const m = t.match(/\(([^)]*)\)/);
                if (m) texts.push(m[1]);
              }
            }
            // TJ 操作符: [(text) num (text)] TJ
            const tjArr = block.match(/\[([^\]]*)\]\s*TJ/g);
            if (tjArr) {
              for (const arr of tjArr) {
                const parts = arr.match(/\(([^)]*)\)/g);
                if (parts) texts.push(parts.map(p => p.slice(1, -1)).join(''));
              }
            }
          }
        }
      } catch (e) { /* 该流解压失败，跳过 */ }
    }

    // 兜底：尝试匹配未压缩的 BT/ET（某些 PDF 流不压缩）
    if (!texts.length) {
      const btBlocks = raw.match(/BT[\s\S]*?ET/g);
      if (btBlocks) {
        for (const block of btBlocks) {
          const tj = block.match(/\(([^)]*)\)\s*Tj/g);
          if (tj) for (const t of tj) {
            const m = t.match(/\(([^)]*)\)/);
            if (m) texts.push(m[1]);
          }
        }
      }
    }

    return texts.join('\n');
  }

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
          <div class="rba-frow"><label>学历要求</label><select id="filterEducation"><option value="all">不限</option><option value="none">学历不限</option><option value="associate">我的学历：大专</option><option value="bachelor">我的学历：本科</option><option value="master">我的学历：硕士</option><option value="doctor">我的学历：博士</option></select></div>
          <div class="rba-frow"><label>风险等级</label><select id="filterRisk"><option value="all">不限</option><option value="high">⚠ 高风险</option><option value="medium">⚡ 中风险</option><option value="low">✓ 低风险</option><option value="analyzing">🔄 分析中</option></select></div>
          <div style="margin-top:8px"><button class="rba-btn-applyfilter" style="width:100%;padding:8px;background:linear-gradient(135deg,#5DADE2,#2E86C1);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:.3px">应用筛选</button></div>
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
          <div class="rba-frow" style="flex-direction:column;align-items:stretch"><label style="margin-bottom:4px">📄 我的简历 <input type="file" id="aiPdfInput" accept=".pdf" style="display:none"><button class="rba-pdf-btn" id="btnPdfUpload" title="上传PDF简历自动提取文本">📎 PDF</button></label><textarea id="aiResume" rows="4" placeholder="粘贴简历文本或点📎上传PDF，AI 将分析匹配度（可选）" style="width:100%;padding:6px 8px;border:1px solid #d1d1d1;border-radius:4px;font-size:12px;resize:vertical;font-family:inherit"></textarea></div>
          <div class="rba-ai-actions">
            <button class="rba-btn-ai-analyze" id="btnAiAnalyze">🤖 AI 分析当前岗位</button>
            <span class="rba-ai-status" id="aiStatus"></span>
            <button class="rba-debug-btn" id="btnDebugLog" title="查看最近错误日志">🔧</button>
          </div>
        </div>
      </div>
    </div>
    <div class="rba-list-wrap">
      <div class="rba-listheader"><span class="rba-jobcount">0 个岗位</span><div><button class="rba-btn-selectall">全选</button><button class="rba-btn-invert">反选</button><button class="rba-btn-refresh">刷新</button></div></div>
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
#rba-panel{--rba-pri:#5DADE2;--rba-pri-dk:#2E86C1;--rba-pri-lt:#D6EAF8;--rba-acc:#3498DB;--rba-suc:#27AE60;--rba-err:#E74C3C;--rba-txt:#1a1a2e;--rba-txt2:#6B8299;--rba-txt3:#9BA8B5;--rba-bg:#F4F7FA;--rba-surf:#fff;--rba-bor:#E8EDF2;--rba-sh:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);--rba-sh-md:0 4px 12px rgba(0,0,0,.08);--rba-r:8px;--rba-rs:6px;position:fixed;top:0;right:0;width:clamp(390px,35vw,520px);height:100vh;background:var(--rba-bg);z-index:2147483646;font:13px/1.5 "Segoe UI",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--rba-txt);display:flex;flex-direction:column;overflow:hidden;user-select:none;transition:transform .25s cubic-bezier(.4,0,.2,1)}
#rba-panel.rba-collapsed{transform:translateX(98%)}
#rba-panel *{box-sizing:border-box;margin:0;padding:0}
#rba-panel button,#rba-panel select,input,textarea{font-family:inherit}

.rba-header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:linear-gradient(135deg,var(--rba-pri-dk),var(--rba-pri));color:#fff;font-size:15px;font-weight:700;flex-shrink:0;gap:12px;letter-spacing:.3px}
.rba-header-site{font-size:11px;font-weight:400;color:rgba(255,255,255,.75);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rba-loginstatus.rba-ok{color:#90EE90;font-weight:600}
.rba-loginstatus.rba-warn{color:#FFB3B3;font-weight:600}
.rba-close{background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;cursor:pointer;padding:2px 10px;line-height:1;flex-shrink:0;border-radius:6px;transition:background .15s}
.rba-close:hover{background:rgba(255,255,255,.3)}

.rba-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;gap:8px;padding:10px 16px 0}
.rba-filter-wrap{flex-shrink:0;z-index:2}
.rba-ai-wrap{flex-shrink:0;z-index:2}
.rba-ai-section{background:var(--rba-surf);border-radius:var(--rba-r);box-shadow:var(--rba-sh);overflow:hidden}
.rba-ai-toggle{padding:10px 14px;cursor:pointer;font-size:12px;font-weight:600;color:var(--rba-txt);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--rba-bor);transition:background .15s}
.rba-ai-toggle:hover{background:var(--rba-bg)}
.rba-ai-toggle.collapsed{border-bottom:none}
.rba-ai-toggle.collapsed .rba-arrow{transform:rotate(-90deg)}
.rba-ai-panel{padding:8px 14px 12px}
.rba-ai-panel.collapsed{display:none}
.rba-ai-panel input{flex:1;padding:6px 10px;border:1px solid var(--rba-bor);border-radius:var(--rba-rs);font-size:12px;color:var(--rba-txt);outline:none;background:var(--rba-bg);transition:border .15s,box-shadow .15s}
.rba-ai-panel input:focus{border-color:var(--rba-pri);box-shadow:0 0 0 3px rgba(93,173,226,.15)}
.rba-ai-actions{display:flex;align-items:center;gap:10px;margin-top:10px}
.rba-btn-ai-analyze{background:linear-gradient(135deg,var(--rba-pri),var(--rba-pri-dk));color:#fff;border:none;padding:8px 18px;border-radius:var(--rba-r);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .2s}
.rba-btn-ai-analyze:hover:not(:disabled){box-shadow:0 4px 12px rgba(93,173,226,.4);transform:translateY(-1px)}
.rba-btn-ai-analyze:disabled{background:#ccc;cursor:not-allowed;transform:none}
.rba-ai-status{font-size:11px;color:var(--rba-txt2)}
.rba-pdf-btn{background:none;border:1px solid var(--rba-bor);border-radius:var(--rba-rs);font-size:10px;cursor:pointer;padding:2px 8px;margin-left:6px;color:var(--rba-txt2);transition:all .15s}
.rba-pdf-btn:hover{background:var(--rba-bg);color:var(--rba-acc);border-color:var(--rba-acc)}
.rba-debug-btn{background:none;border:1px solid var(--rba-bor);border-radius:var(--rba-rs);font-size:12px;cursor:pointer;padding:2px 8px;color:var(--rba-txt3);margin-left:auto}
.rba-debug-btn:hover{background:var(--rba-bg);color:var(--rba-err)}

.rba-actions-wrap{flex-shrink:0;z-index:2;padding:14px 0 0;border-top:1px solid var(--rba-bor);margin-top:8px}

.rba-filter-section{background:var(--rba-surf);border-radius:var(--rba-r);box-shadow:var(--rba-sh);overflow:hidden}
.rba-filter-toggle{padding:10px 14px;cursor:pointer;font-size:12px;font-weight:600;color:var(--rba-txt);display:flex;align-items:center;gap:6px;transition:background .15s}
.rba-filter-toggle:hover{background:var(--rba-bg)}
.rba-arrow{font-size:10px;transition:transform .2s;color:var(--rba-txt3)}
.rba-filter-toggle.collapsed .rba-arrow{transform:rotate(-90deg)}
.rba-filter-panel{padding:4px 14px 12px}
.rba-filter-panel.collapsed{display:none}
.rba-frow{display:flex;align-items:center;gap:8px;margin-top:8px}
.rba-frow label{width:60px;font-size:12px;color:var(--rba-txt2);flex-shrink:0;font-weight:500}
.rba-frow select{flex:1;padding:6px 10px;border:1px solid var(--rba-bor);border-radius:var(--rba-rs);font-size:12px;color:var(--rba-txt);outline:none;background:var(--rba-bg);cursor:pointer;transition:border .15s,box-shadow .15s}
.rba-frow select:focus{border-color:var(--rba-pri);box-shadow:0 0 0 3px rgba(93,173,226,.15)}

.rba-btn-refresh{background:var(--rba-surf);color:var(--rba-txt);border:1px solid var(--rba-bor)!important;padding:4px 10px;border-radius:var(--rba-rs);cursor:pointer;font-size:11px;transition:all .15s}
.rba-btn-refresh:hover{background:var(--rba-bg);border-color:var(--rba-txt3)!important}
.rba-progress.hidden,.rba-modal.hidden,.rba-toast.hidden,.rba-collapsed .rba-body{display:none!important}

.rba-list-wrap{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.rba-listheader{display:flex;justify-content:space-between;align-items:center;padding:10px 6px;font-size:12px;flex-shrink:0;gap:10px}
.rba-jobcount{font-weight:600;color:var(--rba-txt)}
.rba-listheader button{background:none;border:none;color:var(--rba-acc);cursor:pointer;font-size:11px;padding:3px 10px;border-radius:var(--rba-rs);font-weight:500;transition:all .15s}
.rba-listheader button:hover{background:var(--rba-pri-lt)}

.rba-joblist{flex:1;overflow-y:auto;min-height:0;background:var(--rba-surf);border-radius:var(--rba-r);box-shadow:var(--rba-sh)}
.rba-empty{padding:40px 16px;text-align:center;color:var(--rba-txt3);font-size:12px}
.rba-jobitem{display:flex;align-items:flex-start;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--rba-bor);transition:background .12s,box-shadow .12s;margin:2px 6px;border-radius:var(--rba-rs)}
.rba-jobitem:last-child{border-bottom:none}
.rba-jobitem:hover{background:var(--rba-pri-lt);box-shadow:var(--rba-sh)}
.rba-cb{width:17px;height:17px;min-width:17px;margin-right:10px;margin-top:2px;cursor:pointer;accent-color:var(--rba-pri);flex-shrink:0}
.rba-jobinfo{flex:1;min-width:0}
.rba-jobtitle{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;color:var(--rba-txt)}
.rba-link{color:var(--rba-acc);cursor:pointer}
.rba-link:hover{color:#1a6fb5}
.rba-linkicon{font-size:10px;margin-left:2px;opacity:0;transition:opacity .15s}
.rba-link:hover .rba-linkicon{opacity:1}
.rba-jobcompany{font-size:11px;color:var(--rba-txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rba-jobmeta{font-size:10px;color:var(--rba-txt3);display:flex;gap:5px;flex-wrap:wrap;margin-top:3px;align-items:center}
.rba-jobmeta span{background:var(--rba-bg);padding:2px 8px;border-radius:10px;white-space:nowrap;font-weight:500}

.rba-risk{font-size:10px;padding:2px 8px;border-radius:10px;margin-left:6px;font-weight:600;white-space:nowrap}
.rba-risk-high{background:#fde7e9;color:#c00}
.rba-risk-medium{background:#fef3cd;color:#856404}
.rba-risk-low{background:#d4edda;color:#155724}
.rba-risk-analyzing{background:var(--rba-pri-lt);color:var(--rba-pri-dk);animation:rba-pulse 1.5s infinite}
@keyframes rba-pulse{0%,100%{opacity:1}50%{opacity:.4}}

.rba-match{font-size:10px;padding:2px 8px;border-radius:10px;margin-left:4px;font-weight:700}
.rba-match-high{background:#d4edda;color:#155724}
.rba-match-mid{background:#fef3cd;color:#856404}
.rba-match-low{background:#fde7e9;color:#c00}

.rba-applied{font-size:10px;padding:2px 8px;border-radius:10px;margin-left:4px;font-weight:600;background:#e2e8f0;color:#64748b}
.rba-applied-item{opacity:.65;background:#f8fafc}
.rba-applied-item:hover{opacity:.85}

.rba-progress{padding:8px 0;flex-shrink:0;margin:0 4px}
.rba-barwrap{height:5px;background:var(--rba-bor);border-radius:3px;overflow:hidden}
.rba-bar{height:100%;background:linear-gradient(90deg,var(--rba-pri),var(--rba-acc));border-radius:3px;transition:width .3s;position:relative}
.rba-bar::after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:rba-shimmer 2s infinite}
@keyframes rba-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.rba-progresstext{text-align:center;font-size:11px;color:var(--rba-txt2);margin-top:5px}

.rba-actions{display:flex;gap:12px;padding:4px 0 6px;flex-wrap:wrap}
.rba-actions button{padding:11px 0;border-radius:var(--rba-r);font-size:14px;cursor:pointer;border:none;font-weight:600;flex:1;min-width:100px;transition:all .2s;letter-spacing:.3px}
.rba-actions button:active{transform:scale(.97)}
.rba-btn-apply{background:linear-gradient(135deg,var(--rba-pri),var(--rba-pri-dk));color:#fff}
.rba-btn-apply:hover:not(:disabled){box-shadow:0 4px 14px rgba(93,173,226,.4);transform:translateY(-1px)}
.rba-btn-apply:disabled{background:#ccc;cursor:not-allowed;transform:none}
.rba-btn-schedule{background:var(--rba-bg);color:var(--rba-txt);border:1px solid var(--rba-bor)!important}
.rba-btn-schedule:hover:not(:disabled){background:var(--rba-pri-lt);border-color:var(--rba-pri)!important}
.rba-btn-schedule:disabled{opacity:.4;cursor:not-allowed}
.rba-btn-stop{background:var(--rba-err)!important;color:#fff!important;flex:3 0 100%!important}
.rba-btn-stop:hover:not(:disabled){background:#c0392b!important;box-shadow:0 4px 14px rgba(231,76,60,.35)}

.rba-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.35);backdrop-filter:blur(4px);z-index:2147483647;display:flex;align-items:center;justify-content:center}
.rba-modalbox{background:var(--rba-surf);border-radius:12px;padding:24px;width:340px;box-shadow:0 16px 36px rgba(0,0,0,.2)}
.rba-modalbox h3{font-size:16px;font-weight:700;margin-bottom:14px;color:var(--rba-txt)}
.rba-modalbox input{width:100%;padding:10px 12px;border:1px solid var(--rba-bor);border-radius:var(--rba-rs);font-size:13px;margin-bottom:10px;outline:none;color:var(--rba-txt)}
.rba-modalbox input:focus{border-color:var(--rba-pri);box-shadow:0 0 0 3px rgba(93,173,226,.15)}
.rba-hint{font-size:12px;color:var(--rba-txt3);margin-bottom:16px}
.rba-modalfoot{display:flex;justify-content:flex-end;gap:8px}
.rba-modal-cancel,.rba-modal-confirm{padding:9px 22px;border-radius:var(--rba-r);font-size:13px;cursor:pointer;border:none;font-weight:600}
.rba-modal-cancel{background:var(--rba-bg);color:var(--rba-txt)}
.rba-modal-cancel:hover{background:var(--rba-bor)}
.rba-modal-confirm{background:linear-gradient(135deg,var(--rba-pri),var(--rba-pri-dk));color:#fff}

.rba-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:var(--rba-r);font-size:12px;z-index:2147483647;box-shadow:0 8px 20px rgba(0,0,0,.15);animation:rba-fadein .3s cubic-bezier(.4,0,.2,1);pointer-events:none;max-width:480px;font-weight:500}
.rba-toast-success{background:#d4edda;color:#155724}
.rba-toast-error{background:#f8d7da;color:#721c24}
.rba-toast-info{background:var(--rba-pri-lt);color:var(--rba-pri-dk)}
@keyframes rba-fadein{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

#rba-panel ::-webkit-scrollbar{width:5px}
#rba-panel ::-webkit-scrollbar-track{background:transparent}
#rba-panel ::-webkit-scrollbar-thumb{background:var(--rba-bor);border-radius:3px}
#rba-panel ::-webkit-scrollbar-thumb:hover{background:var(--rba-txt3)}

.rba-collapsed .rba-header{border-radius:0 0 0 10px;writing-mode:vertical-lr;padding:14px 10px;font-size:13px;cursor:pointer;width:28px;letter-spacing:1px;cursor:pointer}
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

  // ===== 断点续投恢复 =====
  async function resumePendingApply() {
    try {
      const r = await chrome.storage.local.get(['pendingQueue', 'pendingSearchUrl', 'pendingTotal', 'pendingDone', 'pendingResults']);
      const queue = r.pendingQueue;
      if (!queue || !queue.length) return;
      const ad = getAdapter();
      if (!ad || !ad.isSearchPage()) {
        // 在聊天页或其他页面 → 尝试返回搜索页
        if (r.pendingSearchUrl) {
          setTimeout(() => { window.location.href = r.pendingSearchUrl; }, 2000);
        }
        return;
      }
      // 在搜索结果页 → 确保面板打开 + 清理断点并继续
      if (!panelEl) createPanel();
      if (!panelVisible) { panelVisible = true; panelEl.classList.remove('rba-collapsed'); setPageMargin(true); }
      await chrome.storage.local.remove(['pendingQueue', 'pendingSearchUrl', 'pendingTotal', 'pendingDone', 'pendingResults']).catch(() => {});
      await sleep(1500);
      // 重新解析页面获取最新的 DOM 元素引用
      await refreshPanelData();
      // 恢复队列：跳过已完成的（queue[0]就是触发跳转的那个）
      const resumeQueue = queue.slice(1);
      if (!resumeQueue.length) {
        isApplying = false; updateApplyUI(false);
        toast('所有岗位已完成 ✓', 'success');
        return;
      }
      applyQueue = resumeQueue;
      stopRequested = false;
      isApplying = true;
      updateApplyUI(true);
      updateProgress(r.pendingDone || 0, r.pendingTotal || queue.length);
      toast(`继续投递（剩余 ${queue.length} 个岗位）`, 'info');
      executeApply(ad);
    } catch (e) { /* 静默 */ }
  }

  // ===== DOM 指纹诊断（用于调试未知站点的选择器） =====
  function captureDomFingerprint() {
    const fp = { url: window.location.href, hostname: window.location.hostname, pathname: window.location.pathname, containers: [], topClasses: [], jobLikeElements: 0 };
    try {
      // 收集所有 class 名及其出现次数
      const clsCount = {};
      document.querySelectorAll('[class]').forEach(el => {
        const cls = String(el.className || '');
        cls.split(/\s+/).filter(Boolean).forEach(c => {
          clsCount[c] = (clsCount[c] || 0) + 1;
        });
      });
      // 取出现次数最多的 30 个 class，过滤掉常见的框架类
      const skipSet = new Set(['clearfix','container','wrapper','row','col','active','hidden','show','hide','visible','disabled','selected','hover','focus','open','close','left','right','center','top','bottom','animated','fade','slide','transition','loading','loaded','empty','error','success','warning','info']);
      fp.topClasses = Object.entries(clsCount)
        .filter(([c]) => !skipSet.has(c.toLowerCase()) && c.length > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([c, n]) => `${c}(${n})`);
      // 找子元素 ≥3 的容器（潜在的岗位列表）
      document.querySelectorAll('ul, ol, [class*="list"], [class*="List"], [class*="wrap"], [class*="Wrap"], [class*="container"], [class*="box"], section, main, article, [class*="result"], [class*="content"]').forEach(el => {
        const children = el.children;
        if (children.length >= 3) {
          const tagCounts = {};
          Array.from(children).forEach(c => { tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1; });
          const dominantTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
          if (dominantTag && dominantTag[1] >= 3) {
            fp.containers.push({
              tag: el.tagName,
              cls: String(el.className || '').slice(0, 80),
              childCount: children.length,
              childTag: dominantTag[0],
              childTagCount: dominantTag[1],
              sampleChildCls: Array.from(children).slice(0, 3).map(c => String(c.className || '').slice(0, 60))
            });
          }
        }
      });
      // 只保留最有可能是岗位列表的容器（子元素 class 名有规律的）
      fp.containers = fp.containers
        .filter(c => c.childCount >= 3 && c.childCount <= 200)
        .sort((a, b) => b.childCount - a.childCount)
        .slice(0, 10);
      // 统计"看起来像岗位卡片"的元素数量
      fp.jobLikeElements = document.querySelectorAll('[class*="job"], [class*="position"], [class*="item"], [class*="card"], [class*="list-item"]').length;
    } catch (e) { fp.error = e.message; }
    return fp;
  }
  setTimeout(async () => {
    const ad = getAdapter();
    if (ad && ad.isSearchPage()) {
      chrome.runtime.sendMessage({ type: 'pageReady', siteName: ad.name, isSearchPage: true }).catch(() => {});
      // 检查是否有未完成的断点
      await resumePendingApply();
    }
  }, 1500);
  console.log('[一键投递] 已加载，站点:', getAdapter()?.name || '未识别');
})();
