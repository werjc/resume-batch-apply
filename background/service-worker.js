/**
 * 后台 Service Worker
 *
 * 职责：
 * 1. 管理定时投递任务（chrome.alarms）
 * 2. 跨组件消息路由
 * 3. chrome.notifications 通知
 * 4. chrome.storage 数据管理
 */

// ========== 工具函数 ==========

/**
 * 投递状态存储 key
 */
const APPLY_STATE_KEY = 'applyState';
const SCHEDULED_TASKS_KEY = 'scheduledTasks';
const APPLY_HISTORY_KEY = 'applyHistory';

/**
 * 获取当前投递状态
 */
async function getApplyState() {
  const result = await chrome.storage.local.get(APPLY_STATE_KEY);
  return result[APPLY_STATE_KEY] || { isApplying: false, current: 0, total: 0 };
}

/**
 * 保存投递状态
 */
async function setApplyState(state) {
  await chrome.storage.local.set({ [APPLY_STATE_KEY]: state });
}

// ========== 安装/启动 ==========

chrome.runtime.onInstalled.addListener(() => {
  console.log('[一键投递] 扩展已安装');

  // 清理过期的定时任务
  cleanExpiredTasks();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[一键投递] 浏览器启动，清理过期任务');
  cleanExpiredTasks();
});

// ========== 定时任务 ==========

/**
 * 监听 alarm 触发
 * 当定时投递的 alarm 触发时，执行投递
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('task_')) return;

  console.log('[一键投递] 定时任务触发:', alarm.name);

  try {
    // 获取任务信息
    const result = await chrome.storage.local.get(SCHEDULED_TASKS_KEY);
    const tasks = result[SCHEDULED_TASKS_KEY] || [];
    const task = tasks.find(t => t.id === alarm.name);

    if (!task) {
      console.log('[一键投递] 任务未找到:', alarm.name);
      return;
    }

    // 查找是否已有该网站的标签页
    const tabs = await chrome.tabs.query({});
    let targetTab = tabs.find(t => {
      try {
        return new URL(t.url).hostname.includes(new URL(task.siteUrl).hostname);
      } catch { return false; }
    });

    if (!targetTab) {
      // 没有找到匹配的标签页，打开新标签页
      targetTab = await chrome.tabs.create({ url: task.siteUrl, active: false });
    } else {
      // 聚焦已有标签页
      await chrome.tabs.update(targetTab.id, { active: true });
    }

    // 等待页面加载
    await waitForTabLoad(targetTab.id);

    // 向内容脚本发送投递指令
    const response = await chrome.tabs.sendMessage(targetTab.id, {
      action: 'startApply',
      jobIds: task.jobs.map(j => j.id)
    }).catch(err => {
      console.error('[一键投递] 发送投递指令失败:', err);
      return null;
    });

    // 显示通知
    if (response && response.success) {
      chrome.notifications.create('scheduled_' + task.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '定时投递已开始',
        message: `正在 ${task.siteName} 投递 ${task.jobs.length} 个岗位`,
        priority: 2
      });

      // 从定时任务列表中移除
      await removeTask(alarm.name);
    } else {
      chrome.notifications.create('scheduled_fail_' + task.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '定时投递失败',
        message: `无法在 ${task.siteName} 执行投递，请手动操作`,
        priority: 2
      });
    }
  } catch (err) {
    console.error('[一键投递] 定时任务执行异常:', err);
  }
});

/**
 * 等待标签页加载完成
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 15000); // 最多等15秒

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // 再等2秒确保页面JS渲染完成
        setTimeout(resolve, 2000);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * 从任务列表移除任务
 */
async function removeTask(taskId) {
  const result = await chrome.storage.local.get(SCHEDULED_TASKS_KEY);
  const tasks = result[SCHEDULED_TASKS_KEY] || [];
  const filtered = tasks.filter(t => t.id !== taskId);
  await chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: filtered });
  await chrome.alarms.clear(taskId).catch(() => {});
}

/**
 * 清理过期任务
 */
async function cleanExpiredTasks() {
  const result = await chrome.storage.local.get(SCHEDULED_TASKS_KEY);
  const tasks = result[SCHEDULED_TASKS_KEY] || [];
  const now = Date.now();

  const valid = [];
  for (const task of tasks) {
    if (new Date(task.scheduledTime).getTime() > now) {
      valid.push(task);
    } else {
      // 清理对应的 alarm
      await chrome.alarms.clear(task.id).catch(() => {});
      console.log('[一键投递] 清理过期任务:', task.id);
    }
  }

  if (valid.length !== tasks.length) {
    await chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: valid });
  }
}

// ========== 消息路由 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'applyProgress': {
      // 投递进度更新 → 转发给 popup
      // popup 监听同一频道，但 service worker 也可以记录
      setApplyState({
        isApplying: true,
        current: message.current,
        total: message.total
      }).catch(() => {});
      break;
    }

    case 'applyComplete': {
      // 投递完成 → 清理状态 + 发通知 + 记录历史
      setApplyState({ isApplying: false, current: 0, total: 0 }).catch(() => {});

      // 保存投递历史
      addToHistory(message).catch(() => {});

      // 发通知
      chrome.notifications.create('apply_done_' + Date.now(), {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '批量投递完成',
        message: `成功 ${message.successCount} 个，失败 ${message.failCount} 个`,
        priority: 2
      }).catch(() => {});
      break;
    }

    case 'applyStopped': {
      setApplyState({ isApplying: false, current: 0, total: 0 }).catch(() => {});
      break;
    }

    case 'scheduleApply': {
      // popup 请求创建定时任务
      const { jobs, scheduledTime, siteUrl, siteName } = message;
      const taskId = 'task_' + Date.now().toString(36);

      // 保存任务
      chrome.storage.local.get(SCHEDULED_TASKS_KEY).then(result => {
        const tasks = result[SCHEDULED_TASKS_KEY] || [];
        tasks.push({
          id: taskId,
          jobs,
          scheduledTime,
          siteUrl,
          siteName,
          createdAt: new Date().toISOString()
        });
        return chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: tasks });
      }).then(() => {
        // 创建 alarm（延迟到指定时间）
        const delayMinutes = Math.max(1, Math.ceil(
          (new Date(scheduledTime).getTime() - Date.now()) / 60000
        ));
        return chrome.alarms.create(taskId, { delayInMinutes: delayMinutes });
      }).then(() => {
        sendResponse({ success: true, taskId });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // 异步响应
    }

    case 'cancelSchedule': {
      const { taskId } = message;
      removeTask(taskId).then(() => {
        sendResponse({ success: true });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'getScheduledTasks': {
      chrome.storage.local.get(SCHEDULED_TASKS_KEY).then(result => {
        sendResponse({ tasks: result[SCHEDULED_TASKS_KEY] || [] });
      });
      return true;
    }

    case 'getApplyState': {
      getApplyState().then(state => {
        sendResponse(state);
      });
      return true;
    }
  }
});

// ========== 投递历史 ==========

async function addToHistory(result) {
  const res = await chrome.storage.local.get(APPLY_HISTORY_KEY);
  const history = res[APPLY_HISTORY_KEY] || [];
  history.unshift({
    time: new Date().toISOString(),
    total: result.total,
    successCount: result.successCount,
    failCount: result.failCount,
    results: (result.results || []).slice(0, 20) // 只保留前20条详情
  });
  // 只保留最近 100 条
  if (history.length > 100) history.length = 100;
  await chrome.storage.local.set({ [APPLY_HISTORY_KEY]: history });
}

// ========== 通知点击 ==========

chrome.notifications.onClicked.addListener((notificationId) => {
  // 用户点击通知时，尝试打开对应标签页
  if (notificationId.startsWith('apply_done_')) {
    // 不做特殊处理，通知自动关闭
  }
});

// ========== 图标点击 → 切换面板 ==========

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (e) {
    // 如果页面不支持（非招聘网站），静默忽略
    console.log('[一键投递] 当前页面不支持面板:', tab.url);
  }
});

console.log('[一键投递] Service Worker 已启动');
