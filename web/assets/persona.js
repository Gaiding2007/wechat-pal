'use strict';

/**
 * 人设编辑页。字段与 src/persona.js 的 normalizePersona 一一对应，
 * 保存走 POST /api/persona，服务端会做长度/类型清洗。
 */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const toastEl = $('#toast');
  let toastTimer = 0;
  let presets = [];
  let activePreset = '';
  let persona = {};
  let dirty = false;

  const STYLES = [
    ['default', '按上面的性格自然说话'],
    ['gentle', '温柔、慢一点'],
    ['tsundere', '傲娇、嘴硬心软'],
    ['tieba', '贴吧腔、爱抬杠'],
    ['calm', '安静、有分寸'],
    ['playful', '活泼、爱逗'],
  ];

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2300);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || (data && data.ok === false)) {
      throw new Error((data && data.error) || `请求失败（${res.status}）`);
    }
    return data;
  }

  function chipList(key, placeholder) {
    const root = $(key);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder || '输入后回车添加';
    input.maxLength = 40;
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === '，' || ev.key === ',') {
        ev.preventDefault();
        add(input.value);
      } else if (ev.key === 'Backspace' && !input.value) {
        const chips = [...root.querySelectorAll('.chip')];
        if (chips.length) chips[chips.length - 1].remove(), markDirty();
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) add(input.value);
    });
    root.append(input);

    function add(value) {
      const text = String(value || '').trim().replace(/^[-*·]\s*/, '');
      if (!text) return;
      for (const chip of root.querySelectorAll('.chip')) {
        if (chip.dataset.value === text) {
          input.value = '';
          return;
        }
      }
      root.insertBefore(makeChip(text), input);
      input.value = '';
      markDirty();
    }

    function makeChip(value) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.value = value;
      chip.append(document.createTextNode(value));
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', `删除 ${value}`);
      del.addEventListener('click', () => {
        chip.remove();
        markDirty();
      });
      chip.append(del);
      return chip;
    }

    return {
      set(values) {
        root.querySelectorAll('.chip').forEach((chip) => chip.remove());
        for (const value of values || []) root.insertBefore(makeChip(String(value)), input);
      },
      get() {
        return [...root.querySelectorAll('.chip')].map((chip) => chip.dataset.value).filter(Boolean);
      },
    };
  }

  const chips = {
    aliases: chipList('#pAliases', '比如：小鲸鱼'),
    personality: chipList('#pPersonality', '比如：傲娇'),
    speaking: chipList('#pSpeaking', '比如：短句'),
    interests: chipList('#pInterests', '比如：白米饭'),
    boundaries: chipList('#pBoundaries', '比如：不骂人'),
    suggestions: chipList('#pSuggestions', '比如：陪我聊会儿'),
  };

  function val(id) {
    return $(id).value.trim();
  }

  function num(id, fallback) {
    const value = Number($(id).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function lines(id) {
    return $(id)
      .value.split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function markDirty() {
    if (!dirty) {
      dirty = true;
      $('#dirtyTip').textContent = '有未保存的修改';
    }
    updatePreview();
  }

  function updatePreview() {
    const name = val('#pName') || '未命名';
    const avatar = val('#pAvatar') || name.slice(0, 1);
    const color = val('#pColorText') || val('#pColor') || '#2f6fb3';
    $('#previewAvatar').textContent = avatar;
    $('#previewAvatar').style.background = color;
    $('#previewName').textContent = name;
    $('#previewTagline').textContent = val('#pTagline');
    $('#previewGreeting').textContent = val('#pGreeting') || '（还没有开场白）';
    $('#previewTags').replaceChildren();
    for (const tag of chips.personality.get().slice(0, 6)) {
      const span = document.createElement('span');
      span.textContent = tag;
      $('#previewTags').append(span);
    }
  }

  function fill(data) {
    persona = data || {};
    $('#pName').value = persona.name || '';
    $('#pAvatar').value = persona.avatar || '';
    $('#pTagline').value = persona.tagline || '';
    $('#pAge').value = persona.age || '';
    $('#pIdentity').value = persona.identity || '';
    $('#pAppearance').value = persona.appearance || '';
    $('#pSelfies').value = (persona.selfies || []).join('\n');
    $('#pBackground').value = persona.background || '';
    const color = persona.color || '#2f6fb3';
    $('#pColor').value = color;
    $('#pColorText').value = color;
    chips.aliases.set(persona.aliases || []);
    chips.personality.set(persona.personality || []);
    chips.speaking.set(persona.speakingStyle || []);
    chips.interests.set(persona.interests || []);
    chips.boundaries.set(persona.boundaries || []);
    chips.suggestions.set(persona.suggestions || []);

    const styleSelect = $('#pStyle');
    styleSelect.replaceChildren();
    for (const [key, label] of STYLES) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      styleSelect.append(opt);
    }
    styleSelect.value = persona.stylePreset || 'default';
    $('#pStyleText').value = persona.styleText || '';
    $('#pEmoji').value = String(persona.emojiLevel ?? 2);
    $('#pEmotions').checked = persona.emotions !== false;
    $('#pProactive').checked = Boolean(persona.proactive);
    $('#pOpinions').checked = persona.opinions !== false;
    $('#pLinks').checked = persona.links !== false;

    $('#pPrivateMax').value = persona.privateMaxChars || 140;
    $('#pGroupMax').value = persona.groupMaxChars || 70;
    $('#pBubbles').value = persona.maxBubbles || 3;
    $('#pHistory').value = persona.historyTurns || 20;
    $('#pGroupHistory').value = persona.groupHistoryTurns || 12;
    $('#pGreeting').value = persona.greeting || '';

    const master = persona.master || {};
    $('#pMasterEnabled').checked = Boolean(master.enabled);
    $('#pMasterTitle').value = master.title || '主人';
    $('#pMasterNames').value = (master.names || []).join('\n');
    $('#pMasterWxids').value = (master.wxids || []).join('\n');
    toggleMaster();

    $('#pSystem').value = persona.systemPrompt || '';
    $('#pCustom').value = persona.customPrompt || '';

    dirty = false;
    $('#dirtyTip').textContent = '';
    $('#saveState').textContent = `上次保存：${persona.name || '未命名'}`;

    activePreset = persona.presetId || '';
    renderPresets();
    updatePreview();
  }

  function toggleMaster() {
    const on = $('#pMasterEnabled').checked;
    $('#pMasterNames').disabled = !on;
    $('#pMasterWxids').disabled = !on;
    $('#pMasterTitle').disabled = !on;
    markDirty();
  }

  function renderPresets() {
    const root = $('#presetList');
    root.replaceChildren();
    const ordered = [...presets].sort((a, b) => (b.id === activePreset ? 1 : 0) - (a.id === activePreset ? 1 : 0));
    for (const preset of ordered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset' + (preset.id === activePreset ? ' active' : '');
      const avatar = document.createElement('span');
      avatar.className = 'preset-avatar';
      avatar.textContent = preset.avatar || preset.name.slice(0, 1);
      avatar.style.background = preset.color || '#2f6fb3';
      const text = document.createElement('span');
      text.className = 'preset-text';
      const strong = document.createElement('strong');
      strong.textContent = preset.name;
      const tagline = document.createElement('span');
      tagline.textContent = preset.tagline || '';
      text.append(strong, tagline);
      btn.append(avatar, text);
      btn.addEventListener('click', () => applyPreset(preset));
      root.append(btn);
    }
  }

  async function applyPreset(preset) {
    if (dirty && !confirm(`当前修改还没保存，要用预设「${preset.name}」覆盖吗？`)) return;
    try {
      const data = await api('/api/persona/preset', { method: 'POST', body: { id: preset.id } });
      fill(data.persona);
      toast(`已套用预设：${preset.name}`);
    } catch (err) {
      toast(err.message);
    }
  }

  function collect() {
    const colorText = val('#pColorText');
    const color = /^#[0-9a-f]{6}$/i.test(colorText) ? colorText : $('#pColor').value;
    return {
      name: val('#pName'),
      avatar: val('#pAvatar'),
      color,
      tagline: val('#pTagline'),
      age: val('#pAge'),
      identity: val('#pIdentity'),
      appearance: $('#pAppearance').value.trim(),
      selfies: $('#pSelfies').value.split('\n').map((x) => x.trim()).filter(Boolean),
      background: $('#pBackground').value.trim(),
      aliases: chips.aliases.get(),
      personality: chips.personality.get(),
      speakingStyle: chips.speaking.get(),
      interests: chips.interests.get(),
      boundaries: chips.boundaries.get(),
      suggestions: chips.suggestions.get(),
      stylePreset: $('#pStyle').value,
      styleText: $('#pStyleText').value.trim(),
      emojiLevel: num('#pEmoji', 2),
      emotions: $('#pEmotions').checked,
      proactive: $('#pProactive').checked,
      opinions: $('#pOpinions').checked,
      links: $('#pLinks').checked,
      privateMaxChars: num('#pPrivateMax', 140),
      groupMaxChars: num('#pGroupMax', 70),
      maxBubbles: num('#pBubbles', 3),
      historyTurns: num('#pHistory', 20),
      groupHistoryTurns: num('#pGroupHistory', 12),
      greeting: val('#pGreeting'),
      master: {
        enabled: $('#pMasterEnabled').checked,
        title: val('#pMasterTitle') || '主人',
        names: lines('#pMasterNames'),
        wxids: lines('#pMasterWxids'),
      },
      systemPrompt: $('#pSystem').value.trim(),
      customPrompt: $('#pCustom').value.trim(),
    };
  }

  async function save() {
    if (!val('#pName')) {
      toast('先给它起个名字');
      $('#pName').focus();
      return;
    }
    const buttons = [$('#btnSave'), $('#btnSaveBottom')];
    buttons.forEach((btn) => (btn.disabled = true));
    try {
      const data = await api('/api/persona', { method: 'POST', body: collect() });
      fill(data.persona);
      toast('人设已保存');
    } catch (err) {
      toast(err.message);
    } finally {
      buttons.forEach((btn) => (btn.disabled = false));
    }
  }

  async function reset() {
    if (!confirm('恢复成预设的默认内容？当前修改会丢失。')) return;
    try {
      const data = await api('/api/persona/reset', { method: 'POST', body: { id: activePreset } });
      fill(data.persona);
      toast('已恢复预设');
    } catch (err) {
      toast(err.message);
    }
  }

  function exportJson() {
    const data = JSON.stringify({ ...collect(), exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `persona-${val('#pName') || 'custom'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const data = await api('/api/persona/import', { method: 'POST', body: { persona: raw } });
      fill(data.persona);
      toast('已导入');
    } catch (err) {
      toast(err.message || '导入失败，确认是 JSON 文件');
    }
  }

  function bind() {
    document.addEventListener('input', (ev) => {
      if (ev.target.closest('.topbar')) return;
      markDirty();
    });
    $('#btnSave').addEventListener('click', save);
    $('#btnSaveBottom').addEventListener('click', save);
    $('#btnReset').addEventListener('click', reset);
    $('#btnExport').addEventListener('click', exportJson);
    $('#btnImport').addEventListener('click', () => $('#fileImport').click());
    $('#fileImport').addEventListener('change', (ev) => {
      importJson(ev.target.files && ev.target.files[0]);
      ev.target.value = '';
    });
    $('#pMasterEnabled').addEventListener('change', toggleMaster);
    $('#pColor').addEventListener('input', () => {
      $('#pColorText').value = $('#pColor').value;
      markDirty();
    });
    $('#pColorText').addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(val('#pColorText'))) $('#pColor').value = val('#pColorText');
    });
    window.addEventListener('beforeunload', (ev) => {
      if (!dirty) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
  }

  async function boot() {
    bind();
    try {
      const [list, current] = await Promise.all([api('/api/personas'), api('/api/persona')]);
      presets = list.presets || [];
      fill(current.persona);
    } catch (err) {
      toast(err.message);
    }
  }

  boot();
})();
