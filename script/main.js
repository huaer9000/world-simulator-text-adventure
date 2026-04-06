// ============================================================
// main.js — 初始化入口，绑定所有事件
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  ui = new GameUI();

  const setupScreen = document.getElementById('setup-screen');
  const gameScreen = document.getElementById('game-screen');
  const gameConfigModal = document.getElementById('game-config-modal');
  const configModalTitle = document.getElementById('config-modal-title');
  const apiUrlInput = document.getElementById('api-url');
  const apiKeyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model-select');
  const refreshBtn = document.getElementById('refresh-models-btn');
  const startBtn = document.getElementById('start-btn');
  const continueBtn = document.getElementById('continue-btn');
  const cfgStartBtn = document.getElementById('cfg-start-btn');
  const cfgBackBtn = document.getElementById('cfg-back-btn');
  const cfgRandomBtn = document.getElementById('cfg-random-btn');
  const addNpcBtn = document.getElementById('add-npc-btn');
  const npcEditorList = document.getElementById('npc-editor-list');
  const npcEmpty = document.getElementById('npc-empty');
  const settingsBtn = document.getElementById('settings-btn');
  const gameSettingsBtn = document.getElementById('game-settings-btn');
  const newGameBtn = document.getElementById('new-game-btn');
  const saveGameBtn = document.getElementById('save-game-btn');
  const loadGameBtn = document.getElementById('load-game-btn');
  const backdoorBtn = document.getElementById('backdoor-btn');
  const settingsModal = document.getElementById('settings-modal');
  const promptModal = document.getElementById('prompt-modal');
  const modalApiUrl = document.getElementById('modal-api-url');
  const modalApiKey = document.getElementById('modal-api-key');
  const modalModel = document.getElementById('modal-model');
  const modalRefreshBtn = document.getElementById('modal-refresh-btn');
  const modalSaveBtn = document.getElementById('modal-save-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const promptCloseBtn = document.getElementById('prompt-close-btn');
  const playerInput = document.getElementById('player-input');
  const submitBtn = document.getElementById('submit-btn');
  const toastEl = document.getElementById('toast');

  // 新游戏流程只需两步（玩家 → 世界观），NPC 由游戏后自动解析 + 角色管理入口维护
  const configSteps = ['tab-player', 'tab-world'];
  let configMode = 'new';
  let currentStepIndex = 0;
  let npcDrafts = [];
  let currentGameConfig = null;

  function createNpcDraft(overrides = {}) {
    return {
      id: overrides.id || `npc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      enabled: overrides.enabled ?? true,
      name: overrides.name || '',
      gender: overrides.gender || '女',
      age: overrides.age || '',
      job: overrides.job || '',
      traits: overrides.traits || '',
      appearance: overrides.appearance || '',
      extra: overrides.extra || '',
      source: overrides.source || 'custom',
    };
  }

  function showToast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' toast-error' : ' toast-ok');
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 2500);
  }

  function applySavedModelOption(selectEl, model) {
    if (!model) return;
    selectEl.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    selectEl.appendChild(opt);
    selectEl.value = model;
  }

  function syncSaveButtons() {
    const hasSave = engine.hasSave();
    continueBtn.classList.toggle('hidden', !hasSave);
    loadGameBtn.disabled = !hasSave;
  }

  function saveGameState() {
    return engine.saveGame({ gameConfig: currentGameConfig });
  }

  function readInput(id) {
    return document.getElementById(id).value.trim();
  }

  // ── 自动高度工具 ──────────────────────────────────────────
  function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }
  function initAutoResize(el) {
    if (!el) return;
    el.addEventListener('input', () => autoResize(el));
    autoResize(el);
  }
  // 初始化世界相关自动高度字段
  initAutoResize(document.getElementById('cfg-world-bg'));
  initAutoResize(document.getElementById('cfg-world-scene'));

  function populatePlayerWorld(config) {
    document.getElementById('cfg-player-name').value = config?.player?.name || '';
    document.getElementById('cfg-player-gender').value = config?.player?.gender || '男';
    document.getElementById('cfg-player-traits').value = config?.player?.traits || '';
    document.getElementById('cfg-world-bg').value = config?.world?.background || '';
    document.getElementById('cfg-world-scene').value = config?.world?.scene || '';
    // 填值后重新计算高度
    autoResize(document.getElementById('cfg-world-bg'));
    autoResize(document.getElementById('cfg-world-scene'));
  }

  function collectPlayerWorld() {
    return {
      player: {
        name: readInput('cfg-player-name'),
        gender: document.getElementById('cfg-player-gender').value,
        traits: readInput('cfg-player-traits'),
      },
      world: {
        background: readInput('cfg-world-bg'),
        scene: readInput('cfg-world-scene'),
      },
    };
  }

  function validatePlayerStep() {
    const { player } = collectPlayerWorld();
    if (!player.name || !player.gender || !player.traits) {
      showToast('玩家姓名、性别、性格都必须填写', true);
      return false;
    }
    return true;
  }

  function validateWorldStep() {
    const { world } = collectPlayerWorld();
    if (!world.background || !world.scene) {
      showToast('世界背景和开场场景都必须填写', true);
      return false;
    }
    return true;
  }

  function validateNpcDrafts(showError = false) {
    const enabled = npcDrafts.filter(npc => npc.enabled);
    if (!enabled.length) return true; // NPCs are optional

    const requiredFields = ['name', 'gender', 'age', 'job', 'traits', 'appearance'];
    for (const npc of enabled) {
      const missing = requiredFields.find(field => !String(npc[field] || '').trim());
      if (missing) {
        if (showError) showToast(`角色「${npc.name || '未命名角色'}」还有未填写字段`, true);
        return false;
      }
    }

    return true;
  }

  function updateConfigActions() {
    const step = configSteps[currentStepIndex];
    const inNpcOnlyMode = configMode === 'edit-npc';

    cfgBackBtn.classList.toggle('hidden', currentStepIndex === 0 && !inNpcOnlyMode);
    cfgBackBtn.textContent = inNpcOnlyMode ? '取消' : (currentStepIndex === 0 ? '取消' : '上一步');
    cfgStartBtn.disabled = false;

    if (step === 'tab-player') {
      cfgRandomBtn.classList.add('hidden');
      cfgStartBtn.textContent = '下一步';
    } else if (step === 'tab-world') {
      cfgRandomBtn.classList.remove('hidden');
      cfgStartBtn.textContent = '开始游戏';
    } else {
      // NPC-only edit mode
      cfgRandomBtn.classList.add('hidden');
      cfgStartBtn.textContent = '应用设置';
      cfgStartBtn.disabled = !validateNpcDrafts(false);
    }
  }

  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });
    const idx = configSteps.indexOf(tabId);
    currentStepIndex = idx >= 0 ? idx : currentStepIndex;
    updateConfigActions();
  }

  function renderNpcDrafts() {
    if (!npcEditorList) return;
    npcEditorList.innerHTML = '';
    npcEmpty?.classList.toggle('hidden', npcDrafts.length > 0);

    npcDrafts.forEach((npc, index) => {
      const item = document.createElement('div');
      item.className = 'npc-editor-card';
      item.innerHTML = `
        <div class="npc-editor-header">
          <label class="npc-editor-toggle">
            <input type="checkbox" data-field="enabled" ${npc.enabled ? 'checked' : ''}>
            <span>角色 ${index + 1}</span>
          </label>
          <div class="npc-editor-tools">
            <span class="npc-editor-source">${npc.source === 'ai' ? 'AI' : '手动'}</span>
            <button type="button" class="btn btn-outline btn-sm" data-action="ai-gen">AI生成</button>
            <button type="button" class="btn btn-outline btn-sm npc-editor-remove" data-action="remove">删除</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>姓名</label>
            <input type="text" data-field="name" value="${htmlEsc(npc.name)}" autocomplete="off">
          </div>
          <div class="form-group">
            <label>性别</label>
            <select data-field="gender">
              <option value="女" ${npc.gender === '女' ? 'selected' : ''}>女</option>
              <option value="男" ${npc.gender === '男' ? 'selected' : ''}>男</option>
              <option value="其他" ${npc.gender === '其他' ? 'selected' : ''}>其他</option>
            </select>
          </div>
          <div class="form-group">
            <label>年龄</label>
            <input type="number" data-field="age" value="${htmlEsc(npc.age)}" min="18" max="60">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>职业</label>
            <input type="text" data-field="job" value="${htmlEsc(npc.job)}" autocomplete="off">
          </div>
        </div>
        <div class="form-group">
          <label>性格标签</label>
          <input type="text" data-field="traits" value="${htmlEsc(npc.traits)}" autocomplete="off">
        </div>
        <div class="form-group">
          <label>外貌特征</label>
          <textarea class="auto-resize" rows="2" data-field="appearance" autocomplete="off">${htmlEsc(npc.appearance)}</textarea>
        </div>
        <div class="form-group">
          <label>补充信息</label>
          <textarea class="auto-resize" rows="2" data-field="extra" autocomplete="off">${htmlEsc(npc.extra)}</textarea>
        </div>
      `;

      item.dataset.id = npc.id;
      npcEditorList.appendChild(item);

      // 初始化 auto-resize
      item.querySelectorAll('textarea.auto-resize').forEach(ta => initAutoResize(ta));
    });

    updateConfigActions();
  }

  function collectNpcDraftsFromDom() {
    if (!npcEditorList) return;
    npcDrafts = [...npcEditorList.querySelectorAll('.npc-editor-card')].map(card => ({
      id: card.dataset.id,
      source: card.querySelector('.npc-editor-source')?.textContent === 'AI' ? 'ai' : 'custom',
      enabled: card.querySelector('[data-field="enabled"]').checked,
      name: card.querySelector('[data-field="name"]').value.trim(),
      gender: card.querySelector('[data-field="gender"]').value,
      age: card.querySelector('[data-field="age"]').value.trim(),
      job: card.querySelector('[data-field="job"]').value.trim(),
      traits: card.querySelector('[data-field="traits"]').value.trim(),
      appearance: card.querySelector('[data-field="appearance"]').value.trim(),
      extra: card.querySelector('[data-field="extra"]').value.trim(),
    }));
  }

  function getEnabledNpcs() {
    collectNpcDraftsFromDom();
    return npcDrafts.filter(npc => npc.enabled);
  }

  function openConfigModal(mode = 'new') {
    configMode = mode;
    const npcTabBtn = document.getElementById('tab-npc-btn');

    if (mode === 'edit-npc') {
      configModalTitle.textContent = '角色管理';
      // 仅显示 NPC tab，隐藏其他 tab
      document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.classList.toggle('hidden', btn.dataset.tab !== 'tab-npc');
      });
      npcTabBtn.classList.remove('hidden');
      document.getElementById('tab-player').classList.remove('active');
      document.getElementById('tab-world').classList.remove('active');
      switchTab('tab-npc');
    } else {
      configModalTitle.textContent = '游戏设置';
      // 新游戏：只显示玩家 + 世界观 tab，隐藏 NPC tab
      document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.classList.toggle('hidden', btn.dataset.tab === 'tab-npc');
      });
      document.getElementById('tab-player').classList.remove('config-readonly');
      document.getElementById('tab-world').classList.remove('config-readonly');
      switchTab(configSteps[0]);
    }

    gameConfigModal.classList.remove('hidden');
  }

  function closeConfigModal() {
    gameConfigModal.classList.add('hidden');
  }

  function htmlEsc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function refreshModels(urlInput, keyInput, selectEl, btnEl) {
    const url = urlInput.value.trim();
    const key = keyInput.value.trim();
    if (!url) {
      showToast('请先填写 API 地址', true);
      return;
    }

    btnEl.disabled = true;
    btnEl.textContent = '加载中…';
    selectEl.innerHTML = '<option value="">加载模型列表…</option>';

    try {
      const models = await engine.fetchModels(url, key);
      selectEl.innerHTML = '';
      if (!models.length) {
        selectEl.innerHTML = '<option value="">未找到模型</option>';
        showToast('未找到任何模型', true);
      } else {
        models.forEach(model => {
          const opt = document.createElement('option');
          opt.value = model;
          opt.textContent = model;
          selectEl.appendChild(opt);
        });
        const cfg = engine.loadConfig();
        if (cfg?.model && models.includes(cfg.model)) {
          selectEl.value = cfg.model;
        }
        showToast(`已加载 ${models.length} 个模型`);
      }
    } catch (err) {
      selectEl.innerHTML = '<option value="">加载失败</option>';
      showToast('无法连接：' + err.message, true);
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = '刷新模型';
    }
  }

  async function fetchRandomConfig(target) {
    const headers = { 'Content-Type': 'application/json' };
    if (engine.apiKey) headers.Authorization = `Bearer ${engine.apiKey}`;
    const prompt = target === 'world' ? getActiveWorldGenPrompt() : getActiveNpcGenPrompt();

    const resp = await fetch(`${engine.apiUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: engine.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: 1.1,
        max_tokens: 900,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(jsonStr);
  }

  function applyRandomConfig(cfg) {
    const npcs = Array.isArray(cfg.npcs) ? cfg.npcs : [];
    if (npcs.length) {
      npcDrafts = npcs.map(npc => createNpcDraft({
        enabled: true,
        source: 'ai',
        name: npc.name,
        gender: npc.gender,
        age: npc.age,
        job: npc.job,
        traits: npc.traits,
        appearance: npc.appearance,
        extra: npc.extra,
      }));
      renderNpcDrafts();
    }

    if (cfg.world?.background) {
      const el = document.getElementById('cfg-world-bg');
      el.value = cfg.world.background;
      autoResize(el);
    }
    if (cfg.world?.scene) {
      const el = document.getElementById('cfg-world-scene');
      el.value = cfg.world.scene;
      autoResize(el);
    }
  }

  async function randomizeAll() {
    if (!engine.apiUrl || !engine.model) {
      showToast('请先在设置页配置 API 地址和模型', true);
      return;
    }

    cfgRandomBtn.disabled = true;
    cfgRandomBtn.classList.add('loading');
    cfgRandomBtn.textContent = '🎲 生成中…';

    try {
      const cfg = await fetchRandomConfig('world');
      const bgEl = document.getElementById('cfg-world-bg');
      const sceneEl = document.getElementById('cfg-world-scene');
      if (cfg.world?.background) { bgEl.value = cfg.world.background; autoResize(bgEl); }
      if (cfg.world?.scene)      { sceneEl.value = cfg.world.scene; autoResize(sceneEl); }
      showToast('世界观已随机生成');
    } catch (err) {
      showToast('生成失败：' + err.message, true);
    } finally {
      cfgRandomBtn.disabled = false;
      cfgRandomBtn.classList.remove('loading');
      cfgRandomBtn.textContent = '🎲 随机生成';
    }
  }

  /**
   * 根据配置对象拼装发给 AI 的配置文本，并同步到 engine.configMessage。
   * 供新游戏开始和 NPC 更新共用。
   */
  function buildConfigTextFromData(player, world, npcs) {
    const lines = [
      `[玩家设定]`,
      `姓名：${player.name}，性别：${player.gender}，性格：${player.traits}`,
      '',
      `[世界观]`,
      world.background,
      `开场场景：${world.scene}`,
    ];

    const enabledNpcs = (npcs || []).filter(n => n.enabled !== false);
    if (enabledNpcs.length) {
      lines.push('', '[角色设定]');
      enabledNpcs.forEach(npc => {
        lines.push(
          `• ${npc.name}：${npc.gender}，${npc.age}岁，${npc.job}，性格[${npc.traits}]，外貌[${npc.appearance}]${npc.extra ? `，补充[${npc.extra}]` : ''}`
        );
      });
    }

    lines.push('', `请根据以上设定直接生成开场剧情，输出完整面板和行动建议，无需介绍游戏规则。`);
    const text = lines.join('\n').trim();
    engine.setConfig(text);
    return text;
  }

  /** 从 DOM 表单收集数据，更新 currentGameConfig 并同步到 engine */
  function buildConfigMessage() {
    const data = collectPlayerWorld();
    const enabledNpcs = getEnabledNpcs();
    currentGameConfig = { player: data.player, world: data.world, npcs: enabledNpcs };
    return buildConfigTextFromData(data.player, data.world, enabledNpcs);
  }

  function populateNpcDrafts(npcs) {
    npcDrafts = (npcs || []).map(npc => createNpcDraft(npc));
    renderNpcDrafts();
  }

  function restoreSavedGame(savedGame) {
    if (!savedGame) {
      showToast('未找到可用存档', true);
      syncSaveButtons();
      return;
    }

    currentGameConfig = savedGame.gameConfig || null;
    if (currentGameConfig?.npcs) populateNpcDrafts(currentGameConfig.npcs);
    if (currentGameConfig) populatePlayerWorld(currentGameConfig);

    // 读档时恢复 configMessage：优先用存档里的，否则从 currentGameConfig 重建
    if (!engine.configMessage && currentGameConfig?.player) {
      buildConfigTextFromData(
        currentGameConfig.player,
        currentGameConfig.world || {},
        currentGameConfig.npcs || []
      );
    }

    setupScreen.classList.remove('active');
    gameScreen.classList.add('active');

    if (engine.currentRoundIndex !== null) {
      const round = engine.getCurrentRound();
      if (round) ui.renderRound(round);
      else ui.renderHistory(engine.conversationHistory);
    } else {
      ui.renderHistory(engine.conversationHistory);
    }

    updateRoundIndicator();
    syncSaveButtons();
    showToast('存档已读取');
  }

  async function sendToLLM(text, silent = false) {
    if (ui.isStreaming) return;
    ui.isStreaming = true;
    ui.setLoading(true);

    // 发送时立即清空回复建议
    ui.actionButtons.innerHTML = '';
    ui.actionButtons.classList.add('hidden');
    document.getElementById('round-history-panel')?.classList.add('hidden');

    if (engine.currentRoundIndex !== null) {
      engine.branchFromRound(engine.currentRoundIndex);
    }

    // 每回合独立显示
    ui.clearOutput();

    try {
      if (!silent && text && text.trim()) ui.appendUserMessage(text);
      const response = await engine.sendMessage(text);
      const fullText = await ui.streamResponse(response);

      // 首次回合：尝试从 AI 输出自动解析 NPC
      if (engine.rounds.length === 1) {
        autoPopulateNpcsFromOutput(fullText);
      }

      updateRoundIndicator();
      saveGameState();
      syncSaveButtons();
    } catch (err) {
      if (err.name !== 'AbortError') {
        ui.appendSystemMessage('❌ 错误：' + err.message, true);
      }
    } finally {
      engine.abortController = null;
      ui.isStreaming = false;
      ui.setLoading(false);
    }
  }

  function resetGameConfig() {
    currentGameConfig = null;
    npcDrafts = [];
    populatePlayerWorld(null);
    renderNpcDrafts();
    document.getElementById('cfg-player-gender').value = '男';
  }

  refreshBtn.addEventListener('click', () => {
    refreshModels(apiUrlInput, apiKeyInput, modelSelect, refreshBtn);
  });

  addNpcBtn?.addEventListener('click', () => {
    collectNpcDraftsFromDom();
    npcDrafts.unshift(createNpcDraft());
    renderNpcDrafts();
  });

  npcEditorList?.addEventListener('input', () => {
    collectNpcDraftsFromDom();
    updateConfigActions();
  });

  npcEditorList?.addEventListener('change', () => {
    collectNpcDraftsFromDom();
    updateConfigActions();
  });

  // npcEditorList click 由下方统一代理（含 ai-gen + remove）

  // Tab 标签直接点击切换（自由跳转，无需按顺序）
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (!tabId || btn.classList.contains('hidden')) return;
      switchTab(tabId);
    });
  });

  cfgRandomBtn.addEventListener('click', randomizeAll);

  startBtn.addEventListener('click', () => {
    const url = apiUrlInput.value.trim();
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!url) {
      showToast('请填写 API 地址', true);
      return;
    }
    if (!model) {
      showToast('请先刷新并选择模型', true);
      return;
    }

    engine.configure(url, key, model);
    engine.saveConfig();
    resetGameConfig();
    openConfigModal('new');
  });

  continueBtn.addEventListener('click', () => {
    restoreSavedGame(engine.loadGame());
  });

  cfgBackBtn.addEventListener('click', () => {
    if (configMode === 'edit-npc' || currentStepIndex === 0) {
      closeConfigModal();
      return;
    }
    switchTab(configSteps[currentStepIndex - 1]);
  });

  cfgStartBtn.addEventListener('click', async () => {
    if (configMode === 'edit-npc') {
      if (!validateNpcDrafts(true)) return;
      buildConfigMessage();
      closeConfigModal();
      showToast('角色设置已更新，下一回合起生效');
      return;
    }

    if (currentStepIndex === 0) {
      if (!validatePlayerStep()) return;
      switchTab('tab-world');
      return;
    }

    // 世界观步骤 → 直接开始游戏（NPCs 可为空，游戏后自动解析）
    if (currentStepIndex === 1) {
      if (!validateWorldStep()) return;
      engine.resetGame();
      buildConfigMessage();
      setupScreen.classList.remove('active');
      gameScreen.classList.add('active');
      closeConfigModal();
      await sendToLLM('', true);
      return;
    }
  });

  gameConfigModal.addEventListener('click', (e) => {
    if (e.target === gameConfigModal) closeConfigModal();
  });

  newGameBtn.addEventListener('click', () => {
    if (!confirm('确定要开始新游戏吗？当前进度将丢失。')) return;
    engine.resetGame();
    ui.clearOutput();
    resetGameConfig();
    openConfigModal('new');
  });

  gameSettingsBtn.addEventListener('click', () => {
    populateNpcDrafts(currentGameConfig?.npcs || npcDrafts);
    openConfigModal('edit-npc');
  });

  settingsBtn.addEventListener('click', () => {
    modalApiUrl.value = engine.apiUrl;
    modalApiKey.value = engine.apiKey;
    applySavedModelOption(modalModel, engine.model);
    settingsModal.classList.remove('hidden');
  });

  modalCloseBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

  modalRefreshBtn.addEventListener('click', () => {
    refreshModels(modalApiUrl, modalApiKey, modalModel, modalRefreshBtn);
  });

  modalSaveBtn.addEventListener('click', () => {
    const url = modalApiUrl.value.trim();
    const key = modalApiKey.value.trim();
    const model = modalModel.value;
    if (!url) {
      showToast('请填写 API 地址', true);
      return;
    }
    if (!model) {
      showToast('请先选择模型', true);
      return;
    }
    engine.configure(url, key, model);
    engine.saveConfig();
    apiUrlInput.value = url;
    apiKeyInput.value = key;
    applySavedModelOption(modelSelect, model);
    settingsModal.classList.add('hidden');
    showToast('设置已保存');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });

  // ── Prompt 管理器 ──────────────────────────────────────────

  const PM_CATEGORIES = {
    system:   { label: '系统 Prompt',  listId: 'pm-list-system',   addId: 'add-system-btn' },
    worldGen: { label: '世界生成',     listId: 'pm-list-worldGen', addId: 'add-worldGen-btn' },
    npcGen:   { label: 'NPC 生成',     listId: 'pm-list-npcGen',   addId: 'add-npcGen-btn' },
  };

  function pmSwitchTab(tabId) {
    promptModal.querySelectorAll('[data-pm-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pmTab === tabId);
    });
    promptModal.querySelectorAll('.pm-tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `pm-tab-${tabId}`);
    });
  }

  function pmBuildCard(category, entry, isOnly) {
    const card = document.createElement('div');
    card.className = 'pm-card' + (entry.active ? ' pm-card-active' : '');
    card.dataset.id = entry.id;

    // ── header ──
    const header = document.createElement('div');
    header.className = 'pm-card-header';

    const dot = document.createElement('span');
    dot.className = 'pm-dot' + (entry.active ? ' pm-dot-on' : '');
    dot.title = entry.active ? '已激活' : '未激活';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'pm-name-input';
    nameInput.value = entry.name;
    nameInput.placeholder = makeDefaultPromptName();
    nameInput.spellcheck = false;
    nameInput.addEventListener('blur', () => {
      const v = nameInput.value.trim() || makeDefaultPromptName();
      nameInput.value = v;
      updatePromptEntry(category, entry.id, { name: v });
    });

    const nameWrap = document.createElement('div');
    nameWrap.className = 'pm-name-wrap';
    nameWrap.appendChild(dot);
    nameWrap.appendChild(nameInput);

    const btns = document.createElement('div');
    btns.className = 'pm-card-btns';

    if (entry.active) {
      const lbl = document.createElement('span');
      lbl.className = 'pm-active-lbl';
      lbl.textContent = '✓ 已激活';
      btns.appendChild(lbl);
    } else {
      const activateBtn = document.createElement('button');
      activateBtn.className = 'btn btn-outline btn-sm';
      activateBtn.textContent = '激活';
      activateBtn.addEventListener('click', () => {
        activatePromptEntry(category, entry.id);
        pmRenderPane(category);
      });
      btns.appendChild(activateBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-outline btn-sm pm-edit-toggle';
    editBtn.textContent = '编辑';
    btns.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm pm-del-btn';
    delBtn.textContent = '删除';
    if (isOnly) { delBtn.disabled = true; delBtn.title = '至少保留一个'; }
    delBtn.addEventListener('click', () => {
      if (!confirm(`确定删除「${entry.name}」？`)) return;
      if (deletePromptEntry(category, entry.id)) pmRenderPane(category);
    });
    btns.appendChild(delBtn);

    header.appendChild(nameWrap);
    header.appendChild(btns);
    card.appendChild(header);

    // ── body (collapsed) ──
    const body = document.createElement('div');
    body.className = 'pm-card-body hidden';

    const textarea = document.createElement('textarea');
    textarea.className = 'pm-textarea';
    textarea.value = entry.content;
    textarea.spellcheck = false;
    body.appendChild(textarea);

    const footer = document.createElement('div');
    footer.className = 'pm-card-footer';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = '保存内容';
    saveBtn.addEventListener('click', () => {
      updatePromptEntry(category, entry.id, { content: textarea.value });
      entry.content = textarea.value;
      body.classList.add('hidden');
      editBtn.textContent = '编辑';
      showToast('已保存');
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-outline btn-sm';
    resetBtn.textContent = '恢复默认';
    resetBtn.addEventListener('click', () => {
      if (!confirm('确定将此 Prompt 内容恢复为默认值吗？')) return;
      textarea.value = getDefaultPromptContent(category);
      showToast('已填入默认内容，点「保存内容」生效');
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
      textarea.value = entry.content;
      body.classList.add('hidden');
      editBtn.textContent = '编辑';
    });

    footer.appendChild(saveBtn);
    footer.appendChild(resetBtn);
    footer.appendChild(cancelBtn);
    body.appendChild(footer);
    card.appendChild(body);

    // wire edit toggle
    editBtn.addEventListener('click', () => {
      const open = !body.classList.contains('hidden');
      if (open) {
        textarea.value = entry.content;
        body.classList.add('hidden');
        editBtn.textContent = '编辑';
      } else {
        body.classList.remove('hidden');
        editBtn.textContent = '收起';
        textarea.focus();
      }
    });

    return card;
  }

  function pmRenderPane(category) {
    const cfg = PM_CATEGORIES[category];
    if (!cfg) return;
    const container = document.getElementById(cfg.listId);
    if (!container) return;
    container.innerHTML = '';
    const list = getPromptList(category);
    if (!list.length) {
      container.innerHTML = '<div class="pm-empty">暂无 Prompt，点击「新增」创建</div>';
      return;
    }
    list.forEach(entry => container.appendChild(pmBuildCard(category, entry, list.length <= 1)));
  }

  function pmRenderAll() {
    Object.keys(PM_CATEGORIES).forEach(cat => pmRenderPane(cat));
  }

  function pmAddNew(category) {
    const entry = addPromptEntry(category, '', getDefaultPromptContent(category));
    pmRenderPane(category);
    const card = document.querySelector(`#${PM_CATEGORIES[category].listId} [data-id="${entry.id}"]`);
    if (card) {
      const body = card.querySelector('.pm-card-body');
      const editBtn = card.querySelector('.pm-edit-toggle');
      const nameInput = card.querySelector('.pm-name-input');
      body?.classList.remove('hidden');
      if (editBtn) editBtn.textContent = '收起';
      nameInput?.focus();
      nameInput?.select();
    }
  }

  // Tab switching
  promptModal.querySelectorAll('[data-pm-tab]').forEach(btn => {
    btn.addEventListener('click', () => pmSwitchTab(btn.dataset.pmTab));
  });

  // Add buttons
  Object.keys(PM_CATEGORIES).forEach(cat => {
    document.getElementById(PM_CATEGORIES[cat].addId)
      ?.addEventListener('click', () => pmAddNew(cat));
  });

  backdoorBtn.addEventListener('click', () => {
    pmRenderAll();
    pmSwitchTab('system');
    promptModal.classList.remove('hidden');
  });

  // ── 显示设置 ──────────────────────────────────────────────

  const DISPLAY_KEY = 'llm_game_display_v1';
  const displayBtn   = document.getElementById('display-btn');
  const displayPanel = document.getElementById('display-panel');

  const FONT_FAMILIES = {
    mono:  "'Courier New', Courier, monospace",
    sans:  "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    serif: "'Songti SC', STSong, 'SimSun', Georgia, serif",
  };

  function loadDisplaySettings() {
    try {
      const raw = localStorage.getItem(DISPLAY_KEY);
      return raw ? JSON.parse(raw) : { theme: 'dark', size: 14, font: 'mono' };
    } catch { return { theme: 'dark', size: 14, font: 'mono' }; }
  }

  function saveDisplaySettings(s) {
    try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(s)); } catch {}
  }

  function applyDisplaySettings(s) {
    // 主题
    document.documentElement.setAttribute('data-theme', s.theme);
    // 字号
    document.documentElement.style.setProperty('--font-size', s.size + 'px');
    // 字体
    const fam = FONT_FAMILIES[s.font] || FONT_FAMILIES.mono;
    document.documentElement.style.setProperty('--font-family', fam);
    // 更新面板按钮高亮
    displayPanel.querySelectorAll('[data-theme]').forEach(b =>
      b.classList.toggle('dp-active', b.dataset.theme === s.theme));
    displayPanel.querySelectorAll('[data-size]').forEach(b =>
      b.classList.toggle('dp-active', String(b.dataset.size) === String(s.size)));
    displayPanel.querySelectorAll('[data-font]').forEach(b =>
      b.classList.toggle('dp-active', b.dataset.font === s.font));
  }

  let displaySettings = loadDisplaySettings();
  applyDisplaySettings(displaySettings);

  displayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    displayPanel.classList.toggle('hidden');
  });

  displayPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('.dp-btn');
    if (!btn) return;
    if (btn.dataset.theme) {
      displaySettings.theme = btn.dataset.theme;
    } else if (btn.dataset.size) {
      displaySettings.size = Number(btn.dataset.size);
    } else if (btn.dataset.font) {
      displaySettings.font = btn.dataset.font;
    }
    saveDisplaySettings(displaySettings);
    applyDisplaySettings(displaySettings);
  });

  // 点击面板外部关闭
  document.addEventListener('click', (e) => {
    if (!displayPanel.classList.contains('hidden') &&
        !displayPanel.contains(e.target) &&
        e.target !== displayBtn) {
      displayPanel.classList.add('hidden');
    }
  });

  promptCloseBtn.addEventListener('click', () => promptModal.classList.add('hidden'));

  promptModal.addEventListener('click', (e) => {
    if (e.target === promptModal) promptModal.classList.add('hidden');
  });

  saveGameBtn.addEventListener('click', () => {
    if (!engine.rounds.length) {
      showToast('当前还没有可存档的游戏进度', true);
      return;
    }
    if (saveGameState()) {
      syncSaveButtons();
      showToast('游戏已存档');
    } else {
      showToast('存档失败，请稍后重试', true);
    }
  });

  loadGameBtn.addEventListener('click', () => {
    if (ui.isStreaming) return;
    restoreSavedGame(engine.loadGame());
  });

  submitBtn.addEventListener('click', () => {
    if (ui.isStreaming) {
      engine.stopStreaming();
      return;
    }
    const text = playerInput.value.trim();
    if (!text) return;
    playerInput.value = '';
    sendToLLM(text);
  });

  playerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitBtn.click();
    }
  });

  // ── 后悔药系统 ──────────────────────────────────────────────

  function extractGamePanelSummary(text) {
    const re = /[-—─]{2,}\s*[【\[]游戏面板[】\]]\s*[-—─]{2,}([\s\S]*?)(?:[-—─]{2,}|$)/;
    const m = text.match(re);
    if (!m) return '';
    return m[1].split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' · ');
  }

  function updateRoundIndicator() {
    const el = document.getElementById('round-indicator');
    if (!el) return;
    const { current, total } = engine.getRoundInfo();
    if (!total) {
      el.classList.add('hidden');
      el.classList.remove('browsing');
      return;
    }
    el.classList.remove('hidden');
    const isBrowsing = engine.currentRoundIndex !== null;
    el.classList.toggle('browsing', isBrowsing);
    el.textContent = isBrowsing ? `第 ${current}/${total} 回` : `第 ${current} 回`;
  }

  function renderRoundHistory() {
    const list = document.getElementById('rh-list');
    if (!list) return;
    list.innerHTML = '';

    if (!engine.rounds.length) {
      list.innerHTML = '<div class="rh-empty">还没有任何回合记录</div>';
      return;
    }

    // 倒序显示（最新在上）
    [...engine.rounds].reverse().forEach((round, revIdx) => {
      const idx = engine.rounds.length - 1 - revIdx;
      const isCurrent = (engine.currentRoundIndex === null && idx === engine.rounds.length - 1) ||
                         idx === engine.currentRoundIndex;

      const item = document.createElement('div');
      item.className = 'rh-item' + (isCurrent ? ' rh-item-current' : '');

      const summary = extractGamePanelSummary(round.assistantOutput);
      const userSnip = round.userInput
        ? `<span class="rh-user-input">${htmlEsc(round.userInput.slice(0, 40))}${round.userInput.length > 40 ? '…' : ''}</span>`
        : '';

      item.innerHTML = `
        <div class="rh-item-header">
          <span class="rh-round-num">第 ${idx + 1} 回</span>
          ${isCurrent ? '<span class="rh-current-badge">当前</span>' : ''}
          ${userSnip}
        </div>
        ${summary ? `<div class="rh-panel-summary">${htmlEsc(summary)}</div>` : ''}
      `;

      if (!isCurrent) {
        item.addEventListener('click', () => {
          if (!confirm(`确定回到第 ${idx + 1} 回？之后的回合将会消失。`)) return;
          engine.branchFromRound(idx);
          ui.renderRound(engine.rounds[idx]);
          document.getElementById('round-history-panel')?.classList.add('hidden');
          updateRoundIndicator();
          saveGameState();
        });
      }

      list.appendChild(item);
    });
  }

  const itemsBtn = document.getElementById('items-btn');
  const roundHistoryPanel = document.getElementById('round-history-panel');
  const rhCloseBtn = document.getElementById('rh-close-btn');

  itemsBtn?.addEventListener('click', () => {
    if (!localStorage.getItem('items_tutorial_shown')) {
      localStorage.setItem('items_tutorial_shown', '1');
    }
    itemsBtn?.classList.remove('items-tutorial');
    const isHidden = roundHistoryPanel?.classList.contains('hidden') !== false;
    if (isHidden) {
      renderRoundHistory();
      roundHistoryPanel?.classList.remove('hidden');
    } else {
      roundHistoryPanel?.classList.add('hidden');
    }
  });

  rhCloseBtn?.addEventListener('click', () => {
    roundHistoryPanel?.classList.add('hidden');
  });

  // 首次进入游戏页时触发教程脉冲动画
  if (!localStorage.getItem('items_tutorial_shown')) {
    setTimeout(() => {
      itemsBtn?.classList.add('items-tutorial');
    }, 1200);
  }

  // ── NPC 单个 AI 生成 ──────────────────────────────────────

  async function fetchSingleNpc(cardEl) {
    if (!engine.apiUrl || !engine.model) {
      showToast('请先配置 API 地址和模型', true);
      return;
    }

    const aiBtn = cardEl.querySelector('[data-action="ai-gen"]');
    if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = '生成中…'; }

    try {
      // 获取当前世界观文本（优先从游戏配置，其次从表单）
      const worldBg = currentGameConfig?.world?.background
        || document.getElementById('cfg-world-bg')?.value?.trim()
        || '';
      const worldScene = currentGameConfig?.world?.scene
        || document.getElementById('cfg-world-scene')?.value?.trim()
        || '';
      const worldCtx = [worldBg, worldScene].filter(Boolean).join('\n');

      const basePrompt = getActiveNpcGenPrompt()
        .replace('{世界观}', worldCtx)
        .replace('{开场}', worldScene);

      const singlePrompt = basePrompt + '\n\n（只生成1个NPC，不要数组，直接返回单个对象）';

      const headers = { 'Content-Type': 'application/json' };
      if (engine.apiKey) headers.Authorization = `Bearer ${engine.apiKey}`;

      const resp = await fetch(`${engine.apiUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: engine.model,
          messages: [{ role: 'user', content: singlePrompt }],
          stream: false,
          temperature: 1.1,
          max_tokens: 600,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content || '';
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      let npc = JSON.parse(jsonStr);
      // 支持 {npcs:[...]} 格式
      if (Array.isArray(npc.npcs)) npc = npc.npcs[0];
      if (Array.isArray(npc)) npc = npc[0];

      // 填充到卡片 DOM
      const set = (field, val) => {
        const el = cardEl.querySelector(`[data-field="${field}"]`);
        if (!el || !val) return;
        el.value = val;
        if (el.tagName === 'TEXTAREA') { autoResize(el); }
      };
      set('name', npc.name);
      set('gender', npc.gender);
      set('age', String(npc.age || ''));
      set('job', npc.job);
      set('traits', npc.traits);
      set('appearance', npc.appearance);
      set('extra', npc.extra);

      // 更新 source 标签
      const srcEl = cardEl.querySelector('.npc-editor-source');
      if (srcEl) srcEl.textContent = 'AI';

      collectNpcDraftsFromDom();
      updateConfigActions();
      showToast(`已生成角色：${npc.name || '(无名)'}`);
    } catch (err) {
      showToast('AI 生成失败：' + err.message, true);
    } finally {
      if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = 'AI生成'; }
    }
  }

  // NPC 卡片：AI生成 / 删除 按钮事件代理
  npcEditorList?.addEventListener('click', (e) => {
    const card = e.target.closest('.npc-editor-card');
    if (!card) return;

    if (e.target.closest('[data-action="ai-gen"]')) {
      collectNpcDraftsFromDom();
      fetchSingleNpc(card);
      return;
    }

    const removeBtn = e.target.closest('[data-action="remove"]');
    if (removeBtn) {
      collectNpcDraftsFromDom();
      npcDrafts = npcDrafts.filter(npc => npc.id !== card.dataset.id);
      renderNpcDrafts();
    }
  });

  // ── 首次回合 NPC 自动解析 ────────────────────────────────

  function autoPopulateNpcsFromOutput(text) {
    const delimRe = /[-—─]{2,}\s*[【\[]([^\]】]{1,30})[】\]]\s*[-—─]{2,}/g;
    const parts = [];
    let lastIndex = 0, lastTitle = null, match;
    while ((match = delimRe.exec(text)) !== null) {
      if (lastTitle !== null) {
        parts.push({ title: lastTitle, content: text.slice(lastIndex, match.index).trim() });
      }
      lastTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastTitle !== null) parts.push({ title: lastTitle, content: text.slice(lastIndex).trim() });

    let changed = false;
    for (const { title, content } of parts) {
      if (!title.endsWith('面板') || /游戏|玩家/.test(title)) continue;
      const name = title.replace(/面板$/, '').trim();
      if (!name || npcDrafts.some(n => n.name === name)) continue;

      let gender = '女', age = '', job = '', traits = '', appearance = '';

      const basicLine = content.split('\n').find(l => /⚧️/.test(l));
      if (basicLine) {
        const gm = basicLine.match(/⚧️\s*([男女其他])/); if (gm) gender = gm[1];
        const am = basicLine.match(/🎂\s*(\d+)/); if (am) age = am[1];
        const jm = basicLine.match(/💼\s*([^|｜\n]+)/); if (jm) job = jm[1].trim();
      }
      const traitsLine = content.split('\n').find(l => /性格[：:]/.test(l));
      if (traitsLine) { const tm = traitsLine.match(/性格[：:]\s*(.+)/); if (tm) traits = tm[1].trim(); }
      const appLine = content.split('\n').find(l => /外貌[：:]/.test(l));
      if (appLine) { const em = appLine.match(/外貌[：:]\s*(.+)/); if (em) appearance = em[1].trim(); }

      npcDrafts.push(createNpcDraft({ name, gender, age, job, traits, appearance, source: 'ai', enabled: true }));
      changed = true;
    }

    if (changed) {
      // 更新 configMessage 加入 AI 识别的角色
      if (currentGameConfig) {
        currentGameConfig.npcs = npcDrafts;
        buildConfigTextFromData(currentGameConfig.player, currentGameConfig.world, npcDrafts);
      }
    }
  }

  // ── 移动端键盘检测（visualViewport） ───────────────────────
  if (window.visualViewport) {
    let lastVH = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const newVH = window.visualViewport.height;
      const diff = lastVH - newVH;
      // 高度缩减超过 100px 认为键盘弹出
      document.body.classList.toggle('keyboard-open', diff > 100);
      lastVH = newVH;
    });
  }

  // ── 隐藏入口：连按 10 次 Shift 显示/隐藏 Prompt管理 ────────
  (function () {
    let count = 0;
    let timer = null;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Shift' && !e.repeat) {
        count++;
        clearTimeout(timer);
        timer = setTimeout(() => { count = 0; }, 2000);
        if (count >= 10) {
          count = 0;
          clearTimeout(timer);
          backdoorBtn.classList.toggle('hidden');
          if (!backdoorBtn.classList.contains('hidden')) showToast('已显示 Prompt 管理入口');
        }
      } else if (!['Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key) && !e.repeat) {
        count = 0;
        clearTimeout(timer);
      }
    });
  })();

  const savedConfig = engine.loadConfig();
  if (savedConfig) {
    apiUrlInput.value = savedConfig.apiUrl || DEFAULT_API_URL;
    apiKeyInput.value = savedConfig.apiKey || '';
    applySavedModelOption(modelSelect, savedConfig.model);
    engine.configure(
      savedConfig.apiUrl || DEFAULT_API_URL,
      savedConfig.apiKey || '',
      savedConfig.model || ''
    );
  } else {
    apiUrlInput.value = DEFAULT_API_URL;
  }

  syncSaveButtons();
  resetGameConfig();
});
