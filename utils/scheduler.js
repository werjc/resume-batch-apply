/**
 * 定时任务管理工具
 * 基于 chrome.alarms API 实现定时投递
 */

const Scheduler = {
  /**
   * 创建定时投递任务
   * @param {Object} task { jobs, scheduledTime, siteUrl, siteName }
   * @returns {Promise<Object>} 创建的任务对象
   */
  async schedule(task) {
    const taskId = 'task_' + Date.now().toString(36);

    // 保存任务到 storage
    const savedTask = await Storage.addScheduledTask({
      ...task,
      id: taskId
    });

    // 计算延迟时间（毫秒）
    const scheduledTime = new Date(task.scheduledTime).getTime();
    const now = Date.now();
    const delayMs = scheduledTime - now;

    if (delayMs <= 0) {
      throw new Error('定时时间必须是未来的时间');
    }

    // chrome.alarms 使用分钟作为最小单位
    const delayMinutes = Math.max(1, Math.ceil(delayMs / 60000));

    // 创建 alarm
    await chrome.alarms.create(taskId, {
      delayInMinutes: delayMinutes
    });

    console.log(`[Scheduler] 定时任务已创建: ${taskId}, ${delayMinutes} 分钟后执行`);
    return savedTask;
  },

  /**
   * 取消定时任务
   * @param {string} taskId
   */
  async cancel(taskId) {
    await chrome.alarms.clear(taskId);
    await Storage.removeScheduledTask(taskId);
    console.log(`[Scheduler] 定时任务已取消: ${taskId}`);
  },

  /**
   * 获取所有待执行的定时任务
   * @returns {Promise<Array>}
   */
  async getPendingTasks() {
    const tasks = await Storage.getScheduledTasks();
    const now = Date.now();
    // 只返回未到时间的任务
    return tasks.filter(t => new Date(t.scheduledTime).getTime() > now);
  },

  /**
   * 获取所有已过期的定时任务
   * @returns {Promise<Array>}
   */
  async getExpiredTasks() {
    const tasks = await Storage.getScheduledTasks();
    const now = Date.now();
    return tasks.filter(t => new Date(t.scheduledTime).getTime() <= now);
  },

  /**
   * 清理过期的定时任务
   */
  async cleanExpired() {
    const tasks = await Storage.getScheduledTasks();
    const now = Date.now();
    const valid = tasks.filter(t => new Date(t.scheduledTime).getTime() > now);

    // 清理对应的 alarms
    const expired = tasks.filter(t => new Date(t.scheduledTime).getTime() <= now);
    for (const t of expired) {
      await chrome.alarms.clear(t.id).catch(() => {});
    }

    await Storage.set('scheduledTasks', valid);
  },

  /**
   * 格式化时间显示
   * @param {string|Date} time
   * @returns {string}
   */
  formatTime(time) {
    const d = new Date(time);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
};
