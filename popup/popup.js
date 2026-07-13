/**
 * Popup 弹窗交互逻辑
 *
 * 核心功能：
 * - 自动识别当前招聘网站
 * - 解析搜索结果中的岗位列表
 * - 筛选条件过滤
 * - 勾选岗位、一键投递 / 定时投递
 * - 停止投递
 */

// ========== 状态 ==========
let currentTabId = null;
let currentSiteUrl = '';
let currentSiteName = '';
let allJobs = [];           // 所有解析出的岗位
let filteredJobs = [];      // 筛选后的岗位
let selectedIds = new Set(); // 已勾选的岗位 ID
let isApplying = false;     // 是否正在投递
let applyCurrent = 0;
let applyTotal = 0;

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  siteName: $('#siteName'),
  loginStatus: $('#loginStatus'),
  errorMsg: $('#errorMsg'),
  filterToggle: $('#filterToggle'),
  filterPanel: $('#filterPanel'),
  filterDate: $('#filterDate'),
  filterCompanyType: $('#filterCompanyType'),
  filterJobType: $('#filterJobType'),
  filterEducation: $('#filterEducation'),
  btnRefresh: $('#btnRefresh'),
  jobCount: $('#jobCount'),
  jobList: $('#jobList'),
  btnSelectAll: $('#btnSelectAll'),
  btnInvert: $('#btnInvert'),
  btnApplyFilter: $('#btnApplyFilter'),
  btnApplyNow: $('#btnApplyNow'),
  btnSchedule: $('#btnSchedule'),
  btnStop: $('#btnStop'),
  scheduleModal: $('#scheduleModal'),
  scheduleTime: $('#scheduleTime'),
  btnScheduleConfirm: $('#btnScheduleConfirm'),
  btnScheduleCancel: $('#btnScheduleCancel'),
  progressContainer: $('#progressContainer'),
  progressBar: $('#progressBar'),
  progressText: $('#progressText'),
  toast: $('#toast'),
  // 统计
  tabJobs: $('#tabJobs'),
  tabStats: $('#tabStats'),
  statsPanel: $('#statsPanel'),
  jobListSection: $('.job-list-section'),
  statTotal: $('#statTotal'),
  statSuccess: $('#statSuccess'),
  statFail: $('#statFail'),
  statRate: $('#statRate'),
  statSiteBreakdown: $('#statSiteBreakdown'),
  btnExportCsv: $('#btnExportCsv'),
  // AI 分析
  aiToggle: $('#aiToggle'),
  aiPanel: $('#aiPanel'),
  aiProvider: $('#aiProvider'),
  aiModel: $('#aiModel'),
  aiKey: $('#aiKey'),
  aiResume: $('#aiResume'),
  aiPdfInput: $('#aiPdfInput'),
  btnPdfUpload: $('#btnPdfUpload'),
  btnAiAnalyze: $('#btnAiAnalyze'),
  aiStatus: $('#aiStatus')
};

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', async () => {
  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showError('无法获取当前标签页');
    return;
  }

  currentTabId = tab.id;
  currentSiteUrl = tab.url;

  // 检测站点
  if (!detectSite()) {
    showError('当前页面不是支持的招聘网站<br><br>支持的网站：BOSS直聘、智联招聘、国聘、大学生就业服务平台、前程无忧、猎聘、实习僧、校友邦');
    disableAllButtons();
    return;
  }

  dom.siteName.textContent = currentSiteName;

  // 加载记忆的筛选条件和 AI 配置
  await Promise.all([loadFilters(), loadAiConfig()]);

  // 加载数据
  await Promise.all([checkStatus(), loadJobs(), loadApplyState()]);

  // 绑定事件
  bindEvents();
});

// ========== 站点检测 ==========

function detectSite() {
  const url = currentSiteUrl;
  const siteMap = [
    { domain: 'zhipin.com', name: 'BOSS直聘' },
    { domain: 'zhaopin.com', name: '智联招聘' },
    { domain: 'iguopin.com', name: '国聘' },
    { domain: 'ncss.cn', name: '大学生就业服务平台' },
    { domain: '51job.com', name: '前程无忧' },
    { domain: 'liepin.com', name: '猎聘' },
    { domain: 'shixiseng.com', name: '实习僧' },
    { domain: 'xiaoyoubang.com', name: '校友邦' }
  ];

  for (const site of siteMap) {
    if (url.includes(site.domain)) {
      currentSiteName = site.name;
      return true;
    }
  }
  return false;
}

// ========== 状态检查 ==========

async function checkStatus() {
  try {
    const resp = await chrome.tabs.sendMessage(currentTabId, { action: 'checkStatus' });
    if (resp && resp.success) {
      const loggedIn = resp.loggedIn;
      dom.loginStatus.textContent = loggedIn ? '已登录' : '未登录';
      dom.loginStatus.className = 'value ' + (loggedIn ? 'status-ok' : 'status-error');

      if (!resp.isSearchPage) {
        showToast('当前页面不是搜索结果页，可能无法解析岗位', 'info');
      }
      if (resp.hasCaptcha) {
        showToast('检测到验证码，投递前请先手动验证', 'info');
      }
    }
  } catch (e) {
    dom.loginStatus.textContent = '请刷新页面后重试';
    dom.loginStatus.className = 'value status-error';
  }
}

// ========== 岗位解析 ==========

async function loadJobs() {
  dom.jobList.innerHTML = '<div class="job-list-empty">正在解析岗位列表...</div>';

  try {
    const resp = await chrome.tabs.sendMessage(currentTabId, { action: 'parseJobs' });
    if (resp && resp.success && resp.jobs) {
      allJobs = resp.jobs;
      // 加载已投 ID 并标记
      try {
        const r = await chrome.storage.local.get('appliedJobIds');
        const appliedIds = r.appliedJobIds || [];
        allJobs.forEach(j => { j.applied = appliedIds.includes(j.id); });
      } catch (e) {}
      applyFilters();
    } else {
      dom.jobList.innerHTML = '<div class="job-list-empty">未能解析到岗位，请确认在搜索结果页</div>';
      allJobs = [];
      filteredJobs = [];
      updateJobCount();
    }
  } catch (e) {
    dom.jobList.innerHTML = '<div class="job-list-empty">请刷新招聘网站页面后重试</div>';
    allJobs = [];
    filteredJobs = [];
    updateJobCount();
  }
}

// ========== 投递状态加载 ==========

async function loadApplyState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'getApplyState' });
    if (state && state.isApplying) {
      isApplying = true;
      applyCurrent = state.current || 0;
      applyTotal = state.total || 0;
      updateUIForApplying(true);
      updateProgress(applyCurrent, applyTotal);
    }
  } catch (e) {
    // Service Worker 可能未就绪
  }
}

// ========== 筛选逻辑 ==========

function applyFilters() {
  const dateFilter = dom.filterDate.value;
  const companyTypeFilter = dom.filterCompanyType.value;
  const jobTypeFilter = dom.filterJobType.value;
  const educationFilter = dom.filterEducation.value;

  filteredJobs = allJobs.filter(job => {
    // 发布日期筛选
    if (dateFilter !== 'all' && job.dateObj) {
      const daysAgo = (Date.now() - job.dateObj.getTime()) / (1000 * 60 * 60 * 24);
      if (daysAgo > parseInt(dateFilter)) return false;
    }

    // 公司类型筛选
    if (companyTypeFilter !== 'all') {
      if (job.companyType !== companyTypeFilter && job.companyType !== 'unknown') return false;
    }

    // 岗位类型筛选
    if (jobTypeFilter !== 'all') {
      if (job.jobType !== jobTypeFilter) return false;
    }

    // 学历筛选（"我的学历 >= 岗位要求" 才算匹配）
    if (educationFilter !== 'all') {
      if (!matchEducation(educationFilter, job.education || 'none')) return false;
    }

    return true;
  });

  // 清除已不存在的勾选
  const filteredIds = new Set(filteredJobs.map(j => j.id));
  for (const id of selectedIds) {
    if (!filteredIds.has(id)) selectedIds.delete(id);
  }

  renderJobList();
  updateJobCount();
}

function renderJobList() {
  if (filteredJobs.length === 0) {
    dom.jobList.innerHTML = '<div class="job-list-empty">没有匹配的岗位</div>';
    return;
  }

  dom.jobList.innerHTML = filteredJobs.map(job => {
    const checked = selectedIds.has(job.id) ? 'checked' : '';
    const dateDisplay = job.date || '';
    const salaryDisplay = job.salary ? ` ${job.salary}` : '';
    const locationDisplay = job.location ? ` ${job.location}` : '';
    const typeLabel = getJobTypeLabel(job.jobType);
    const educationLabel = getEducationLabel(job.education);
    const hasUrl = job.url && job.url !== '';
    const risk = job.risk;
    let riskBadge = '';
    if (risk) {
      const aiTag = risk.ai ? '·AI' : '';
      if (risk.level === 'analyzing') riskBadge = '<span class="risk-badge risk-analyzing">🔄 分析中</span>';
      else if (risk.level === 'high') riskBadge = `<span class="risk-badge risk-high" title="${escapeHtml((risk.reasons||[]).join('; '))}">⚠ 高风险${aiTag}</span>`;
      else if (risk.level === 'medium') riskBadge = `<span class="risk-badge risk-medium" title="${escapeHtml((risk.reasons||[]).join('; '))}">⚡ 中风险${aiTag}</span>`;
      else if (risk.level === 'low') riskBadge = `<span class="risk-badge risk-low">✓ 低风险${aiTag}</span>`;
    }
    let matchBadge = '';
    if (job.matchScore !== undefined) {
      const ms = job.matchScore;
      const mTitle = escapeHtml((job.matchReasons||[]).join('; '));
      if (ms >= 70) matchBadge = `<span class="risk-badge risk-low" title="${mTitle}">🎯 ${ms}%匹配</span>`;
      else if (ms >= 40) matchBadge = `<span class="risk-badge risk-medium" title="${mTitle}">🎯 ${ms}%匹配</span>`;
      else matchBadge = `<span class="risk-badge risk-high" title="${mTitle}">🎯 ${ms}%匹配</span>`;
    }

    const appliedTag = job.applied ? '<span class="risk-badge risk-low">✓ 已投</span>' : '';
    return `
      <div class="job-item${job.applied?' job-applied':''}" data-id="${escapeHtml(job.id)}">
        <input type="checkbox" class="job-checkbox" data-id="${escapeHtml(job.id)}" ${checked} ${job.applied?'disabled':''}>
        <div class="job-info">
          <div class="job-title ${hasUrl ? 'job-title-link' : ''}"
               ${hasUrl ? `data-url="${escapeHtml(job.url)}" title="点击跳转到详情页"` : ''}>
            ${escapeHtml(job.title)}
            ${hasUrl ? '<span class="link-icon">↗</span>' : ''}
            ${riskBadge}${matchBadge}${appliedTag}
          </div>
          <div class="job-company">${escapeHtml(job.company)}${salaryDisplay}</div>
          <div class="job-meta">
            ${locationDisplay ? `<span>${escapeHtml(locationDisplay.trim())}</span>` : ''}
            <span>${typeLabel}</span>
            ${educationLabel ? `<span>${escapeHtml(educationLabel)}</span>` : ''}
            ${dateDisplay ? `<span>${escapeHtml(dateDisplay)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 绑定岗位名点击跳转事件
  dom.jobList.querySelectorAll('.job-title-link').forEach(titleEl => {
    titleEl.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止触发行选中
      const url = titleEl.dataset.url;
      if (url) {
        chrome.tabs.create({ url: url, active: false });
        showToast('已在新标签页打开岗位详情', 'info');
      }
    });
  });

  // 绑定复选框事件
  dom.jobList.querySelectorAll('.job-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.disabled) return;
      const id = cb.dataset.id;
      if (cb.checked) { selectedIds.add(id); } else { selectedIds.delete(id); }
      updateJobCount();
    });
  });

  dom.jobList.querySelectorAll('.job-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.job-title-link')) return;
      const cb = item.querySelector('.job-checkbox');
      if (cb.disabled) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });
}

function updateJobCount() {
  dom.jobCount.textContent = `搜索到 ${filteredJobs.length} 个岗位`;
  if (selectedIds.size > 0) {
    dom.jobCount.textContent += `（已选 ${selectedIds.size} 个）`;
  }
}

function getJobTypeLabel(type) {
  const map = { fulltime: '全职', intern: '实习', parttime: '兼职' };
  return map[type] || type;
}

/**
 * 学历筛选匹配逻辑
 * @param {string} userLevel 用户选择的学历（none|associate|bachelor|master|doctor）
 * @param {string} jobEducation 岗位要求的学历
 * @returns {boolean} 用户学历是否满足岗位要求
 */
function matchEducation(userLevel, jobEducation) {
  const levels = { none: 0, associate: 1, bachelor: 2, master: 3, doctor: 4 };
  const user = levels[userLevel] || 0;
  const required = levels[jobEducation] || 0;
  // 用户学历 >= 岗位要求 → 匹配
  return user >= required;
}

function getEducationLabel(edu) {
  const map = { none: '学历不限', associate: '大专', bachelor: '本科', master: '硕士', doctor: '博士' };
  return map[edu] || '';
}

// ========== 筛选记忆 ==========

const FILTERS_KEY = 'popupFilters';

async function saveFilters() {
  const data = {
    filterDate: dom.filterDate.value,
    filterCompanyType: dom.filterCompanyType.value,
    filterJobType: dom.filterJobType.value,
    filterEducation: dom.filterEducation.value,
    filterCollapsed: dom.filterToggle.classList.contains('collapsed')
  };
  try {
    await chrome.storage.local.set({ [FILTERS_KEY]: data });
  } catch (e) { /* 静默忽略 */ }
}

async function loadFilters() {
  try {
    const result = await chrome.storage.local.get(FILTERS_KEY);
    const data = result[FILTERS_KEY];
    if (!data) return;

    if (data.filterDate) dom.filterDate.value = data.filterDate;
    if (data.filterCompanyType) dom.filterCompanyType.value = data.filterCompanyType;
    if (data.filterJobType) dom.filterJobType.value = data.filterJobType;
    if (data.filterEducation) dom.filterEducation.value = data.filterEducation;

    if (data.filterCollapsed) {
      dom.filterToggle.classList.add('collapsed');
      dom.filterPanel.classList.add('collapsed');
    }
  } catch (e) { /* 静默忽略 */ }
}

// ========== 事件绑定 ==========

function bindEvents() {
  // 筛选折叠（+记忆）
  dom.filterToggle.addEventListener('click', () => {
    dom.filterToggle.classList.toggle('collapsed');
    dom.filterPanel.classList.toggle('collapsed');
    saveFilters();
  });

  // 筛选 change → 只记忆，不自动应用
  dom.filterDate.addEventListener('change', saveFilters);
  dom.filterCompanyType.addEventListener('change', saveFilters);
  dom.filterJobType.addEventListener('change', saveFilters);
  dom.filterEducation.addEventListener('change', saveFilters);
  // 确定按钮 → 应用筛选
  dom.btnApplyFilter.addEventListener('click', () => { applyFilters(); saveFilters(); showToast('筛选已应用', 'success'); });

  // 全选
  dom.btnSelectAll.addEventListener('click', () => {
    filteredJobs.forEach(j => selectedIds.add(j.id));
    renderJobList();
    updateJobCount();
  });

  // 反选
  dom.btnInvert.addEventListener('click', () => {
    const newSelected = new Set();
    filteredJobs.forEach(j => {
      if (!selectedIds.has(j.id)) newSelected.add(j.id);
    });
    selectedIds = newSelected;
    renderJobList();
    updateJobCount();
  });

  // 立即投递
  dom.btnApplyNow.addEventListener('click', startApply);

  // 定时投递
  dom.btnSchedule.addEventListener('click', openScheduleModal);
  dom.btnScheduleCancel.addEventListener('click', closeScheduleModal);
  dom.btnScheduleConfirm.addEventListener('click', confirmSchedule);

  // 点击弹窗背景关闭
  dom.scheduleModal.addEventListener('click', (e) => {
    if (e.target === dom.scheduleModal) closeScheduleModal();
  });

  // 停止投递
  dom.btnStop.addEventListener('click', stopApply);

  dom.btnRefresh.addEventListener('click', async () => {
    await loadJobs();
    showToast('已刷新岗位列表', 'info');
  });

  // AI 分析折叠
  dom.aiToggle.addEventListener('click', () => {
    dom.aiToggle.classList.toggle('collapsed');
    dom.aiPanel.classList.toggle('collapsed');
  });

  // AI 配置变更记忆
  dom.aiProvider.addEventListener('change', saveAiConfig);
  dom.aiModel.addEventListener('input', saveAiConfig);
  dom.aiKey.addEventListener('input', saveAiConfig);
  dom.aiResume.addEventListener('input', saveAiConfig);
  dom.btnPdfUpload.addEventListener('click', () => dom.aiPdfInput.click());
  dom.aiPdfInput.addEventListener('change', handlePdfUpload);

  // AI 分析按钮
  dom.btnAiAnalyze.addEventListener('click', runAiAnalysis);

  // Tab 切换
  dom.tabJobs.addEventListener('click', () => switchTab('jobs'));
  dom.tabStats.addEventListener('click', () => switchTab('stats'));

  // CSV 导出
  dom.btnExportCsv.addEventListener('click', exportCsv);

  // 监听后台消息（进度更新 + 爬取进度）
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}

// ========== 投递执行 ==========

async function startApply() {
  if (selectedIds.size === 0) {
    showToast('请先勾选要投递的岗位', 'info');
    return;
  }

  if (isApplying) {
    showToast('投递已在进行中', 'info');
    return;
  }

  const jobIds = Array.from(selectedIds);
  try {
    const resp = await chrome.tabs.sendMessage(currentTabId, {
      action: 'startApply',
      jobIds: jobIds
    });

    if (resp && resp.success) {
      isApplying = true;
      applyCurrent = 0;
      applyTotal = jobIds.length;
      updateUIForApplying(true);
      updateProgress(0, applyTotal);
      showToast(`开始投递 ${applyTotal} 个岗位`, 'success');
    } else {
      showToast('启动投递失败：' + (resp?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('通信失败，请刷新招聘网站页面后重试', 'error');
  }
}

async function stopApply() {
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'stopApply' });
    isApplying = false;
    updateUIForApplying(false);
    showToast('已停止投递', 'info');
  } catch (e) {
    showToast('停止失败，请刷新页面', 'error');
  }
}

// ========== 定时投递 ==========

function openScheduleModal() {
  if (selectedIds.size === 0) {
    showToast('请先勾选要投递的岗位', 'info');
    return;
  }

  // 默认时间设为明天上午9点
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  // 格式化为 datetime-local 输入框需要的格式
  const pad = n => String(n).padStart(2, '0');
  const localStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;

  dom.scheduleTime.value = localStr;
  dom.scheduleTime.min = new Date().toISOString().slice(0, 16); // 不能选过去的时间

  dom.scheduleModal.classList.remove('hidden');
}

function closeScheduleModal() {
  dom.scheduleModal.classList.add('hidden');
}

async function confirmSchedule() {
  const timeValue = dom.scheduleTime.value;
  if (!timeValue) {
    showToast('请选择投递时间', 'info');
    return;
  }

  const scheduledTime = new Date(timeValue).toISOString();
  const now = Date.now();

  if (new Date(scheduledTime).getTime() <= now) {
    showToast('请选择未来的时间', 'info');
    return;
  }

  const jobIds = Array.from(selectedIds);
  const selectedJobs = filteredJobs.filter(j => jobIds.includes(j.id));

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'scheduleApply',
      jobs: selectedJobs.map(j => ({ id: j.id, title: j.title, company: j.company })),
      scheduledTime: scheduledTime,
      siteUrl: currentSiteUrl,
      siteName: currentSiteName
    });

    if (resp && resp.success) {
      closeScheduleModal();
      showToast(`已设定定时投递：${formatDateTime(scheduledTime)}，共 ${selectedJobs.length} 个岗位`, 'success');
    } else {
      showToast('定时设置失败：' + (resp?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('设置失败，请重试', 'error');
  }
}

function formatDateTime(isoStr) {
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ========== 进度显示 ==========

function handleBackgroundMessage(message) {
  switch (message.type) {
    case 'applyProgress':
      applyCurrent = message.current;
      applyTotal = message.total;
      updateProgress(applyCurrent, applyTotal);
      break;

    case 'applyComplete':
      isApplying = false;
      updateUIForApplying(false);
      updateProgress(message.total, message.total);
      showToast(
        `投递完成！成功 ${message.successCount} 个，失败 ${message.failCount} 个`,
        message.failCount > 0 ? 'info' : 'success'
      );
      break;

    case 'applyStopped':
      isApplying = false;
      updateUIForApplying(false);
      break;

  }
}

function updateProgress(current, total) {
  if (total === 0) {
    dom.progressContainer.classList.add('hidden');
    return;
  }

  dom.progressContainer.classList.remove('hidden');
  const pct = Math.round((current / total) * 100);
  dom.progressBar.style.width = pct + '%';
  dom.progressText.textContent = `${current}/${total}`;
}

// ========== UI 状态切换 ==========

function updateUIForApplying(applying) {
  isApplying = applying;

  if (applying) {
    dom.btnApplyNow.disabled = true;
    dom.btnApplyNow.textContent = '投递中...';
    dom.btnSchedule.disabled = true;
    dom.btnStop.classList.remove('hidden');
    dom.progressContainer.classList.remove('hidden');
  } else {
    dom.btnApplyNow.disabled = false;
    dom.btnApplyNow.textContent = '立即投递';
    dom.btnSchedule.disabled = false;
    dom.btnStop.classList.add('hidden');
    if (applyTotal === 0) {
      dom.progressContainer.classList.add('hidden');
    }
  }
}

// ========== 错误处理 ==========

function showError(msg) {
  dom.errorMsg.innerHTML = msg;
  dom.errorMsg.classList.remove('hidden');
}

function disableAllButtons() {
  dom.btnApplyNow.disabled = true;
  dom.btnSchedule.disabled = true;
  dom.btnSelectAll.disabled = true;
  dom.btnInvert.disabled = true;
}

// ========== Toast 提示 ==========

let toastTimer = null;

function showToast(msg, type) {
  if (toastTimer) clearTimeout(toastTimer);

  dom.toast.textContent = msg;
  dom.toast.className = 'toast toast-' + (type || 'info');
  dom.toast.classList.remove('hidden');

  toastTimer = setTimeout(() => {
    dom.toast.classList.add('hidden');
  }, 3000);
}

// ========== 工具函数 ==========

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function handlePdfUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('正在提取 PDF 文本...', 'info');
  try {
    const buf = await file.arrayBuffer();
    const text = await extractPdfText(buf);
    if (text.trim().length > 10) {
      dom.aiResume.value = text.trim().slice(0, 8000);
      saveAiConfig();
      showToast('PDF 文本已提取 (' + text.trim().length + ' 字符)', 'success');
    } else {
      showToast('未能提取到文本，请尝试复制粘贴', 'error');
    }
  } catch (err) { showToast('PDF 解析失败，请复制粘贴', 'error'); }
  e.target.value = '';
}

async function extractPdfText(buf) {
  const bytes = new Uint8Array(buf);
  const raw = new TextDecoder('latin1').decode(bytes);
  const texts = [];
  const streamRe = /\/Filter\s*\/FlateDecode[^\n\r>]*>>\s*stream\s*\r?\n([\s\S]*?)endstream/gm;
  let match;
  while ((match = streamRe.exec(raw)) !== null) {
    try {
      const compressed = new Uint8Array(match[1].split('').map(c => c.charCodeAt(0)));
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
      const btBlocks = decompressed.match(/BT[\s\S]*?ET/g);
      if (btBlocks) {
        for (const block of btBlocks) {
          const tj = block.match(/\(([^)]*)\)\s*Tj/g);
          if (tj) for (const t of tj) { const m = t.match(/\(([^)]*)\)/); if (m) texts.push(m[1]); }
          const tjArr = block.match(/\[([^\]]*)\]\s*TJ/g);
          if (tjArr) for (const arr of tjArr) {
            const parts = arr.match(/\(([^)]*)\)/g);
            if (parts) texts.push(parts.map(p => p.slice(1, -1)).join(''));
          }
        }
      }
    } catch (e) { /* skip */ }
  }
  if (!texts.length) {
    const btBlocks = raw.match(/BT[\s\S]*?ET/g);
    if (btBlocks) {
      for (const block of btBlocks) {
        const tj = block.match(/\(([^)]*)\)\s*Tj/g);
        if (tj) for (const t of tj) { const m = t.match(/\(([^)]*)\)/); if (m) texts.push(m[1]); }
      }
    }
  }
  return texts.join('\n');
}

// ========== Tab 切换 ==========

let activeTab = 'jobs';

function switchTab(tab) {
  activeTab = tab;
  dom.tabJobs.classList.toggle('tab-active', tab === 'jobs');
  dom.tabStats.classList.toggle('tab-active', tab === 'stats');
  dom.jobListSection.classList.toggle('hidden', tab !== 'jobs');
  dom.statsPanel.classList.toggle('hidden', tab !== 'stats');
  document.querySelectorAll('.filter-section').forEach(el => {
    el.classList.toggle('hidden', tab !== 'jobs');
  });
  if (tab === 'stats') loadStats();
}

// ========== 统计仪表盘 ==========

async function loadStats() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getApplyHistory' });
    const history = resp?.history || [];
    const total = history.reduce((s, r) => s + (r.total || 0), 0);
    const success = history.reduce((s, r) => s + (r.successCount || 0), 0);
    const fail = history.reduce((s, r) => s + (r.failCount || 0), 0);
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;

    dom.statTotal.textContent = total;
    dom.statSuccess.textContent = success;
    dom.statFail.textContent = fail;
    dom.statRate.textContent = rate + '%';

    // 站点统计
    const sites = {};
    for (const h of history) {
      for (const r of (h.results || [])) {
        const site = h.siteName || '未知';
        if (!sites[site]) sites[site] = { total: 0, success: 0 };
        sites[site].total++;
        if (r.success) sites[site].success++;
      }
    }
    const siteList = Object.entries(sites).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    dom.statSiteBreakdown.innerHTML = siteList.length
      ? siteList.map(([name, s]) =>
          `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f0f0f0">` +
          `<span>${escapeHtml(name)}</span><span>${s.total}投 · ${s.success}成</span></div>`
        ).join('')
      : '<div style="text-align:center">暂无记录</div>';
  } catch (e) { /* ignore */ }
}

// ========== CSV 导出 ==========

async function exportCsv() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getApplyHistory' });
    const history = resp?.history || [];
    if (!history.length) return showToast('没有可导出的记录', 'info');

    const rows = [['时间', '站点', '总投递', '成功', '失败']];
    for (const h of history) {
      rows.push([h.time || '', h.siteName || '', h.total || 0, h.successCount || 0, h.failCount || 0]);
    }
    const csv = '﻿' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `投递记录_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功', 'success');
  } catch (e) { showToast('导出失败', 'error'); }
}

// ========== AI 分析 ==========

const AI_CONFIG_KEY = 'aiConfig';

async function saveAiConfig() {
  const data = {
    provider: dom.aiProvider.value,
    model: dom.aiModel.value.trim(),
    key: dom.aiKey.value.trim(),
    resume: dom.aiResume.value.trim()
  };
  try { await chrome.storage.local.set({ [AI_CONFIG_KEY]: data }); } catch (e) { /* ignore */ }
}

async function loadAiConfig() {
  try {
    const r = await chrome.storage.local.get(AI_CONFIG_KEY);
    const d = r[AI_CONFIG_KEY];
    if (!d) return;
    if (d.provider) dom.aiProvider.value = d.provider;
    if (d.model) dom.aiModel.value = d.model;
    if (d.key) dom.aiKey.value = d.key;
    if (d.resume) dom.aiResume.value = d.resume;
  } catch (e) { /* ignore */ }
}

async function runAiAnalysis() {
  const key = dom.aiKey.value.trim();
  if (!key) return showToast('请先填入 API Key', 'info');
  if (!allJobs.length) return showToast('没有岗位数据', 'info');

  const provider = dom.aiProvider.value;
  const model = dom.aiModel.value.trim() || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
  const endpoint = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions'
    : provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : '';

  dom.btnAiAnalyze.disabled = true;
  dom.aiStatus.textContent = '分析中...';

  // 最多分析 10 个
  const MAX_AI = 10;
  if (allJobs.length > MAX_AI) showToast(`岗位较多，仅分析前 ${MAX_AI} 个（共 ${allJobs.length} 个）`, 'info');
  const resumeText = dom.aiResume.value.trim();
  const sample = allJobs.slice(0, MAX_AI).map(j => ({ id: j.id, title: j.title, company: j.company, salary: j.salary, companyType: j.companyType }));

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'aiAnalyze', jobs: sample, config: { endpoint, model, key }, resume: resumeText || undefined
    });
    if (!resp || resp.error) {
      dom.aiStatus.textContent = resp?.error || '请求失败';
    } else {
      let updated = 0;
      for (const r of (resp.results || [])) {
        const job = allJobs.find(j => j.id === r.id);
        if (job) {
          if (r.risk) job.risk = { level: r.risk.level || 'low', score: r.risk.score || 0, reasons: r.risk.reasons || [], ai: true };
          if (r.companyType && r.companyType !== 'unknown') job.companyType = r.companyType;
          if (r.matchScore !== undefined) { job.matchScore = r.matchScore; job.matchReasons = r.matchReasons; }
          updated++;
        }
      }
      applyFilters();
      dom.aiStatus.textContent = `完成，更新 ${updated} 个岗位`;
      showToast(`AI 分析完成：更新了 ${updated} 个岗位`, 'success');
    }
  } catch (e) {
    dom.aiStatus.textContent = '请求失败: ' + e.message;
  }
  dom.btnAiAnalyze.disabled = false;
}
