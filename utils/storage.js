/**
 * chrome.storage 封装工具
 * 用于持久化存储投递记录、定时任务、用户偏好等数据
 */

// ========== Storage Key 常量（全项目统一） ==========
const STORAGE_KEYS = {
  APPLY_STATE: 'applyState',
  SCHEDULED_TASKS: 'scheduledTasks',
  APPLY_HISTORY: 'applyHistory',
  APPLIED_JOB_IDS: 'appliedJobIds',
  AI_CONFIG: 'aiConfig',
  POPUP_FILTERS: 'popupFilters',
  RESUME: 'resumeText'
};

const Storage = {
  /**
   * 保存数据
   * @param {string} key
   * @param {*} value
   */
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  /**
   * 读取数据
   * @param {string} key
   * @param {*} defaultValue 默认值
   * @returns {Promise<*>}
   */
  async get(key, defaultValue = null) {
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? result[key] : defaultValue;
  },

  /**
   * 删除数据
   * @param {string} key
   */
  async remove(key) {
    await chrome.storage.local.remove(key);
  },

  /**
   * 获取所有数据
   * @returns {Promise<Object>}
   */
  async getAll() {
    return await chrome.storage.local.get(null);
  },

  /**
   * 清空所有数据
   */
  async clear() {
    await chrome.storage.local.clear();
  },

  // ========== 投递历史 ==========

  /**
   * 保存一条投递记录
   * @param {Object} record { jobTitle, company, site, time, status }
   */
  async addHistory(record) {
    const history = await this.get('applyHistory', []);
    history.unshift({
      ...record,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: record.time || new Date().toISOString()
    });
    // 只保留最近 200 条
    if (history.length > 200) {
      history.length = 200;
    }
    await this.set('applyHistory', history);
  },

  /**
   * 获取投递历史
   * @returns {Promise<Array>}
   */
  async getHistory() {
    return await this.get('applyHistory', []);
  },

  // ========== 定时任务 ==========

  /**
   * 保存定时任务
   * @param {Object} task { id, jobs, scheduledTime, siteUrl, siteName, createdAt }
   */
  async addScheduledTask(task) {
    const tasks = await this.get('scheduledTasks', []);
    const newTask = {
      ...task,
      id: task.id || 'task_' + Date.now().toString(36),
      createdAt: task.createdAt || new Date().toISOString()
    };
    tasks.push(newTask);
    await this.set('scheduledTasks', tasks);
    return newTask;
  },

  /**
   * 获取所有定时任务
   * @returns {Promise<Array>}
   */
  async getScheduledTasks() {
    return await this.get('scheduledTasks', []);
  },

  /**
   * 删除定时任务
   * @param {string} taskId
   */
  async removeScheduledTask(taskId) {
    const tasks = await this.get('scheduledTasks', []);
    await this.set('scheduledTasks', tasks.filter(t => t.id !== taskId));
  },

  // ========== 投递状态 ==========

  /**
   * 保存当前投递状态（用于跨 popup 打开/关闭保持状态）
   * @param {Object} state { isApplying, current, total, tabId }
   */
  async setApplyState(state) {
    await this.set('applyState', state);
  },

  /**
   * 获取当前投递状态
   * @returns {Promise<Object>}
   */
  async getApplyState() {
    return await this.get('applyState', { isApplying: false, current: 0, total: 0 });
  },

  /**
   * 清除投递状态
   */
  async clearApplyState() {
    await this.remove('applyState');
  },

  // ========== 已投岗位记录 ==========

  /**
   * 批量标记岗位为已投（追加，不覆盖）
   */
  async markJobsApplied(jobIds) {
    const ids = await this.get(STORAGE_KEYS.APPLIED_JOB_IDS, []);
    let added = 0;
    for (const id of jobIds) {
      if (!ids.includes(id)) { ids.push(id); added++; }
    }
    if (ids.length > 500) ids.splice(0, ids.length - 500);
    await this.set(STORAGE_KEYS.APPLIED_JOB_IDS, ids);
    return added;
  },

  /**
   * 获取已投岗位 ID 列表
   */
  async getAppliedJobIds() {
    return await this.get(STORAGE_KEYS.APPLIED_JOB_IDS, []);
  },

  /**
   * 检查某个岗位是否已投
   */
  async isJobApplied(jobId) {
    const ids = await this.getAppliedJobIds();
    return ids.includes(jobId);
  }
};
