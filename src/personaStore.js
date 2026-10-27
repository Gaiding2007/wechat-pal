'use strict';

/**
 * 当前人设的存储。
 *
 * 预设放在 personas/*.json，可以整套切换；在设置页改过的字段存在
 * data/persona.json，重启后仍然生效。预设本身不会被覆盖，随时可以恢复。
 */
const fs = require('node:fs');
const path = require('node:path');
const { normalizePersona } = require('./persona');
const { loadSettings, saveSettings, writeJsonAtomic, readJson } = require('./config');

class PersonaStore {
  constructor({ config, logger, presets }) {
    this.config = config;
    this.logger = logger;
    this.presets = presets || [];
    this.file = config.paths.personaFile || path.join(config.paths.dataDir, 'persona.json');
    this.current = null;
    this.load();
  }

  load() {
    const saved = readJson(this.file, null);
    const settings = loadSettings(this.config);
    const presetId = (saved && saved.presetId) || settings.personaPresetId || 'whale';
    if (saved && saved.name) {
      this.current = normalizePersona({ ...saved, presetId }, 'persona.json');
      return this.current;
    }
    this.current = this.fromPreset(presetId);
    // 首次启动就把默认预设落盘：微信桥接读到的是同一份人设（名字、别名、关系）。
    if (!saved) this.persist();
    return this.current;
  }

  findPreset(id) {
    return this.presets.find((p) => p.id === id) || this.presets[0] || null;
  }

  fromPreset(id) {
    const preset = this.findPreset(id);
    if (!preset) {
      return normalizePersona({ id: 'whale', name: '鲸鱼娘', presetId: 'whale' }, 'default');
    }
    return normalizePersona({ ...preset, presetId: preset.id }, preset.source || 'preset');
  }

  get() {
    if (!this.current) this.load();
    return this.current;
  }

  /** 合并用户修改，返回保存后的完整人设。 */
  save(patch = {}) {
    const merged = { ...this.get(), ...patch };
    // 数组字段允许直接覆盖，空数组表示清空
    this.current = normalizePersona(merged, 'persona.json');
    this.persist();
    this.logger.info(`人设已保存：${this.current.name}`);
    return this.current;
  }

  applyPreset(id) {
    const preset = this.findPreset(id);
    if (!preset) return null;
    this.current = normalizePersona({ ...preset, presetId: preset.id }, preset.source || 'preset');
    this.persist();
    this.logger.info(`切换人设预设：${this.current.name}（${this.current.presetId}）`);
    return this.current;
  }

  reset(id) {
    const preset = id ? this.findPreset(id) : this.findPreset(this.get().presetId) || this.findPreset('whale');
    if (!preset) return null;
    this.current = normalizePersona({ ...preset, presetId: preset.id }, preset.source || 'preset');
    this.persist();
    this.logger.info(`人设已恢复默认：${this.current.name}`);
    return this.current;
  }

  /** 从导出的 JSON 导入，缺字段用当前值补。 */
  import(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw Object.assign(new Error('人设文件应该是一个 JSON 对象'), { status: 400 });
    }
    const merged = { ...this.get(), ...raw };
    this.current = normalizePersona(merged, 'persona.json');
    this.persist();
    return this.current;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeJsonAtomic(this.file, { ...this.current, savedAt: new Date().toISOString() });
    saveSettings(this.config, { personaPresetId: this.current.presetId || 'custom' });
  }
}

module.exports = { PersonaStore };
