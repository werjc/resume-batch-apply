/**
 * 后台 Service Worker
 *
 * 职责：
 * 1. 管理定时投递任务（chrome.alarms）
 * 2. 跨组件消息路由
 * 3. chrome.notifications 通知
 * 4. chrome.storage 数据管理
 */

importScripts('../utils/storage.js');

// ========== 工具函数 ==========

/**
 * 获取当前投递状态
 */
async function getApplyState() {
  return Storage.getApplyState();
}

/**
 * 保存投递状态
 */
async function setApplyState(state) {
  return Storage.setApplyState(state);
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
    const tasks = await Storage.getScheduledTasks();
    const task = tasks.find(t => t.id === alarm.name);

    if (!task) {
      console.log('[一键投递] 任务未找到:', alarm.name);
      return;
    }

    // 查找是否已有该网站的标签页
    const tabs = await chrome.tabs.query({});
    let targetTab = tabs.find(t => {
      try {
        const taskHost = new URL(task.siteUrl).hostname;
        const tabHost = new URL(t.url).hostname;
        return tabHost.endsWith(taskHost) || taskHost.endsWith(tabHost);
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
  return new Promise(async (resolve) => {
    // 先检查标签页是否已加载完毕
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        setTimeout(resolve, 2000); // 已加载，等2秒渲染
        return;
      }
    } catch (e) { /* 标签页可能不存在 */ }

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
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
  await Storage.removeScheduledTask(taskId);
  await chrome.alarms.clear(taskId).catch(() => {});
}

/**
 * 清理过期任务
 */
async function cleanExpiredTasks() {
  const tasks = await Storage.getScheduledTasks();
  const now = Date.now();

  const valid = [];
  for (const task of tasks) {
    if (new Date(task.scheduledTime).getTime() > now) {
      valid.push(task);
    } else {
      await chrome.alarms.clear(task.id).catch(() => {});
      console.log('[一键投递] 清理过期任务:', task.id);
    }
  }

  if (valid.length !== tasks.length) {
    await Storage.set(STORAGE_KEYS.SCHEDULED_TASKS, valid);
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

      Storage.addScheduledTask({
        id: taskId, jobs, scheduledTime, siteUrl, siteName
      }).then(() => {
        const delayMinutes = Math.max(1, Math.ceil(
          (new Date(scheduledTime).getTime() - Date.now()) / 60000
        ));
        return chrome.alarms.create(taskId, { delayInMinutes: delayMinutes });
      }).then(() => {
        sendResponse({ success: true, taskId });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
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
      Storage.getScheduledTasks().then(tasks => {
        sendResponse({ tasks });
      });
      return true;
    }

    case 'getApplyHistory': {
      Storage.get(STORAGE_KEYS.APPLY_HISTORY, []).then(history => {
        sendResponse({ history });
      });
      return true;
    }

    case 'getApplyState': {
      getApplyState().then(state => { sendResponse(state); });
      return true;
    }
    case 'aiAnalyze': {
      const { jobs, config, resume } = message;
      if (!config?.key || !jobs?.length) { sendResponse({ error: '缺少 API Key 或岗位数据' }); return; }
      analyzeWithLLM(jobs, config, resume).then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
      return true;
    }
  }
});

async function analyzeWithLLM(jobs, config, resume) {
  const endpoint = config.endpoint;
  const model = config.model || 'deepseek-chat';
  const key = config.key;
  if (!endpoint || !key) return { error: '缺少 API 地址或 Key' };

  const jobList = jobs.map(j => `ID:${j.id} | 岗位:"${j.title}" | 公司:"${j.company}" | 薪资:"${j.salary||'未知'}"`).join('\n');
  const resumeSection = resume ? `\n候选人简历：\n${resume}\n请额外对每个岗位评估：简历与岗位的匹配度(matchScore:0-100)和匹配理由(matchReasons)。` : '';
  const matchOutput = resume ? ',"matchScore":0-100,"matchReasons":["理由"]' : '';

  const prompt = `你是一个招聘信息审核专家。请分析以下招聘岗位，对每个岗位返回：(1)风险级别(high/medium/low)和风险原因，(2)根据公司名称推断公司类型(listed上市公司/state国企央企/foreign外企/private民营/startup创业公司)${resume ? '，(3)简历匹配度和匹配理由' : ''}。

返回纯JSON数组（不要markdown包裹）：
[{"id":"岗位id","risk":{"level":"low/medium/high","score":0-100,"reasons":["原因"]},"companyType":"listed/state/foreign/private/startup"${matchOutput}}]

风险判断标准：
- 高风险：日结、押金、培训费、刷单、代收代付、数字货币、高薪+无门槛
- 中风险：岗位名模糊、公司信息缺失、薪资异常高、远程+高薪
- 低风险：信息完整、知名企业、薪资合理

公司类型判断：
- 中字头/国字头/央企上市 → state / 知名上市公司(A股/港股/美股) → listed
- 知名外企(英文名/外资) → foreign / 创业公司(天使轮/A轮) → startup
- 其余有有限公司/科技等后缀 → private
${resume ? '\n简历匹配标准：\n- 匹配度综合评估：技能相关性(40%)、经验匹配(30%)、行业匹配(20%)、职位层级(10%)\n- matchScore: 0-39=低匹配, 40-69=中等匹配, 70-100=高匹配\n- matchReasons: 2-3条简洁理由，说明匹配或不匹配的关键因素' : ''}

岗位列表：
${jobList}${resumeSection}`;

  console.log('[AI分析] 开始请求:', endpoint, 'model:', model);
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: model || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: resume ? 4000 : 2000 }),
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    console.log('[AI分析] 响应状态:', resp.status);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[AI分析] API错误:', resp.status, errText.slice(0, 200));
      return { error: `API 返回 ${resp.status}: ${errText.slice(0, 100)}` };
    }
    const data = await resp.json();
    console.log('[AI分析] 响应数据:', JSON.stringify(data).slice(0, 200));
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { console.error('[AI分析] 未找到JSON:', content.slice(0, 200)); return { error: 'AI 返回格式异常，未找到JSON' }; }
    const results = JSON.parse(jsonMatch[0]);
    console.log('[AI分析] 解析成功:', results.length, '条结果');
    return { results: results.map((r, i) => ({ ...r, id: r.id || jobs[i]?.id })) };
  } catch (e) {
    console.error('[AI分析] 网络异常:', e.message, e);
    return { error: '网络请求失败: ' + e.message };
  }
}

// ========== 投递历史 ==========

async function addToHistory(result) {
  const history = await Storage.get(STORAGE_KEYS.APPLY_HISTORY, []);
  history.unshift({
    time: new Date().toISOString(),
    siteName: result.siteName || '',
    total: result.total,
    successCount: result.successCount,
    failCount: result.failCount,
    results: (result.results || []).slice(0, 20)
  });
  if (history.length > 100) history.length = 100;
  await Storage.set(STORAGE_KEYS.APPLY_HISTORY, history);
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
