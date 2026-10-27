'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 「养鲸鱼」用的轻量状态机。
 *
 * 不追求拟真，只求她有自己的节奏：精力会掉、心情会被聊天影响、
 * 每天有想做的事；网页「生活」页看到的和提示词里用的是同一份状态。
 */
class Life {
  constructor({ config, logger }) {
    this.file = path.join(config.paths.dataDir, 'life.json');
    this.logger = logger;
    this.state = this.load();
    if (!this.state.plan || !this.state.plan.length) this.state.plan = this.makePlan(new Date());
    if (!this.state.activity || !this.state.activity.length) {
      this.state.activity = [{ ts: new Date().toISOString(), text: '刚睡醒，先看一眼今天想做什么。' }];
    }
    this.save();
    this.timer = setInterval(() => this.tick(), 5 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  defaults() {
    const hour = new Date().getHours();
    return {
      mood: 72,
      energy: hour < 8 ? 38 : hour > 23 ? 30 : 76,
      affinity: 12,
      updatedAt: new Date().toISOString(),
      today: new Date().toISOString().slice(0, 10),
      plan: [],
      activity: [],
    };
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...this.defaults(), ...raw };
    } catch {
      return this.defaults();
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn('生活状态保存失败：' + err.message);
    }
  }

  clamp(n, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  tick() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (this.state.today !== today) {
      this.state.today = today;
      this.state.plan = this.makePlan(now);
      this.state.activity.unshift({ ts: now.toISOString(), text: '新的一天，重新排了一下今天想做的事。' });
    }
    const hour = now.getHours();
    let energy = this.state.energy;
    if (hour >= 0 && hour < 7) energy -= 2;
    else if (hour >= 7 && hour < 9) energy += 4;
    else if (hour >= 12 && hour < 14) energy += 2;
    else if (hour >= 22) energy -= 2;
    else energy -= 0.4;
    this.state.energy = this.clamp(energy);
    // 心情向 60 缓慢回归，聊得开心会临时拉高
    this.state.mood = this.clamp(this.state.mood + (this.state.mood < 60 ? 0.6 : -0.15));
    this.state.updatedAt = now.toISOString();
    if (!this.state.plan || !this.state.plan.length) this.state.plan = this.makePlan(now);
    this.save();
  }

  makePlan(now) {
    const hour = now.getHours();
    const pool = [
      '把昨天没写完的稿子收个尾',
      '刷一会儿首页，看看大家在聊什么',
      '给自己泡一杯茶，顺便发呆十分钟',
      '把桌上的东西归位',
      '听一张旧专辑',
      '晚上出去走一小圈',
    ];
    const plan = [];
    if (hour < 11) plan.push('上午先做点正事：' + pool[0], '中午给自己做顿饭：' + pool[3]);
    else if (hour < 18) plan.push('下午慢慢来：' + pool[1], '中间休息：' + pool[2]);
    else plan.push('晚上放松一下：' + pool[5], '睡前：' + pool[4]);
    return plan.slice(0, 3);
  }

  snapshot() {
    return {
      mood: this.state.mood,
      energy: this.state.energy,
      affinity: this.state.affinity,
      updatedAt: this.state.updatedAt,
      plan: this.state.plan,
      activity: this.state.activity.slice(0, 20),
    };
  }

  note(text, delta = {}) {
    const now = new Date();
    if (Number.isFinite(delta.mood)) this.state.mood = this.clamp(this.state.mood + delta.mood);
    if (Number.isFinite(delta.energy)) this.state.energy = this.clamp(this.state.energy + delta.energy);
    if (Number.isFinite(delta.affinity)) this.state.affinity = this.clamp(this.state.affinity + delta.affinity, 0, 999);
    this.state.activity.unshift({ ts: now.toISOString(), text: String(text || '').slice(0, 120) });
    this.state.activity = this.state.activity.slice(0, 40);
    this.state.updatedAt = now.toISOString();
    this.save();
  }
}

module.exports = { Life };
