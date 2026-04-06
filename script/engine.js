// ============================================================
// engine.js — LLM API 调用 + 对话历史管理 + 回合快照
// ============================================================

class Engine {
  constructor() {
    this.conversationHistory = [];
    this.configMessage = '';    // 玩家设定+世界+NPC角色库，每次请求实时注入，不存入 history
    this.apiUrl = DEFAULT_API_URL;
    this.apiKey = '';
    this.model = '';
    this.isStreaming = false;
    this.abortController = null;

    // 回合快照：每完成一回合（user+assistant）追加一条
    // { userInput: string, assistantOutput: string, historySnapshot: [] }
    this.rounds = [];
    // 当前浏览的回合索引，null 表示最新回合
    this.currentRoundIndex = null;
  }

  /** 更新角色库/世界/玩家配置，下次请求时自动注入为第一条 user 消息 */
  setConfig(text) {
    this.configMessage = text || '';
  }

  // ── 配置 ────────────────────────────────────────────────

  configure(apiUrl, apiKey, model) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiKey = apiKey || '';
    this.model = model || '';
  }

  saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        model: this.model,
      }));
    } catch (e) {
      console.warn('配置保存失败:', e);
    }
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  saveGame(extraData = {}) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        conversationHistory: this.conversationHistory,
        rounds: this.rounds,
        currentRoundIndex: this.currentRoundIndex,
        configMessage: this.configMessage,
        ...extraData,
        savedAt: Date.now(),
      }));
      return true;
    } catch (e) {
      console.warn('存档保存失败:', e);
      return false;
    }
  }

  loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data?.conversationHistory) || !Array.isArray(data?.rounds)) {
        return null;
      }

      this.conversationHistory = data.conversationHistory;
      this.rounds = data.rounds;
      this.currentRoundIndex =
        Number.isInteger(data.currentRoundIndex) ? data.currentRoundIndex : null;
      this.configMessage = data.configMessage || '';

      return data;
    } catch (e) {
      console.warn('存档读取失败:', e);
      return null;
    }
  }

  hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  }

  clearSave() {
    localStorage.removeItem(SAVE_KEY);
  }

  // ── 模型列表 ─────────────────────────────────────────────

  async fetchModels(apiUrl, apiKey) {
    const base = (apiUrl || this.apiUrl).replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const resp = await fetch(`${base}/models`, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const models = data.data || data.models || [];
    return models.map(m => m.id || m.name || String(m)).filter(Boolean);
  }

  // ── 对话发送 ─────────────────────────────────────────────

  async sendMessage(userText) {
    if (userText && userText.trim()) {
      this.conversationHistory.push({ role: 'user', content: userText.trim() });
    }
    this._trimHistory();

    // 每次请求都把最新配置注入为第一条 user 消息，不存入 conversationHistory
    const messages = [{ role: 'system', content: getActiveSystemPrompt() }];
    if (this.configMessage) {
      messages.push({ role: 'user', content: this.configMessage });
    }
    messages.push(...this.conversationHistory);

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    this.abortController = new AbortController();
    const resp = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: this.abortController.signal,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: 0.85,
        max_tokens: 2500,
      }),
    });

    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try {
        const errData = await resp.json();
        errMsg = errData.error?.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    return resp;
  }

  stopStreaming() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 将 AI 回复追加到历史记录，并保存回合快照。
   * - conversationHistory 只存精简版（游戏面板+正文+NPC数值行+记忆区）
   * - round snapshot 存完整原文供 UI renderRound 渲染
   */
  appendAssistantMessage(fullText) {
    if (!fullText || !fullText.trim()) return;

    const lastUser = [...this.conversationHistory].reverse().find(m => m.role === 'user');
    const userInput = lastUser?.content || '';

    const slimText = this._extractSlim(fullText);
    this.conversationHistory.push({ role: 'assistant', content: slimText });

    if (this.currentRoundIndex !== null) {
      this.rounds = this.rounds.slice(0, this.currentRoundIndex + 1);
      this.currentRoundIndex = null;
    }

    this.rounds.push({
      userInput,
      assistantOutput: fullText.trim(),
      historySnapshot: JSON.parse(JSON.stringify(this.conversationHistory)),
    });
  }

  /**
   * 从 AI 完整回复中提取精简版存入历史：
   * 保留：游戏面板、正文、NPC 数值行（好感/欲望/警惕）、记忆区
   * 去除：行动建议、NPC 外貌/情绪/心声/性格（角色库已有）、玩家面板
   */
  _extractSlim(fullText) {
    const delimRe = /[-—─]{2,}\s*[【\[]([^\]】]{1,30})[】\]]\s*[-—─]{2,}/g;
    const parts = [];
    let lastIndex = 0;
    let lastTitle = null;
    let match;

    while ((match = delimRe.exec(fullText)) !== null) {
      if (lastTitle !== null) {
        parts.push({ title: lastTitle, content: fullText.slice(lastIndex, match.index).trim() });
      }
      lastTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastTitle !== null) {
      parts.push({ title: lastTitle, content: fullText.slice(lastIndex).trim() });
    }

    // 没有分节结构，原样返回（避免丢失内容）
    if (!parts.length) return fullText.trim();

    const result = [];
    for (const { title, content } of parts) {
      // 保留：游戏面板、正文、记忆区
      if (/游戏面板|记忆区/.test(title) || title === '正文' || title === '正文内容') {
        result.push(`——【${title}】——\n${content}`);
        continue;
      }
      // NPC 面板：只保留数值行（好感/欲望/警惕），其余丢弃
      if (title.endsWith('面板') && !title.includes('玩家面板')) {
        const statsLine = content.split('\n').find(l =>
          /[好感欲望警惕][：:]\s*\d+\/\d+/.test(l)
        );
        if (statsLine) result.push(statsLine.trim());
        continue;
      }
      // 丢弃：玩家面板、行动建议、其他
    }

    return result.join('\n\n') || fullText.trim();
  }

  // ── 回合导航 ─────────────────────────────────────────────

  /** 返回当前浏览的回合对象（null 时取最新） */
  getCurrentRound() {
    if (!this.rounds.length) return null;
    const idx = this.currentRoundIndex !== null
      ? this.currentRoundIndex
      : this.rounds.length - 1;
    return this.rounds[idx] || null;
  }

  /** 切换到上一回合，返回目标回合或 null */
  prevRound() {
    if (!this.rounds.length) return null;
    const current = this.currentRoundIndex !== null
      ? this.currentRoundIndex
      : this.rounds.length - 1;
    const target = current - 1;
    if (target < 0) return null;
    this.currentRoundIndex = target;
    return this.rounds[target];
  }

  /** 切换到下一回合，返回目标回合或 null */
  nextRound() {
    if (this.currentRoundIndex === null) return null; // 已在最新
    const target = this.currentRoundIndex + 1;
    if (target >= this.rounds.length) {
      this.currentRoundIndex = null;
      return this.rounds[this.rounds.length - 1];
    }
    this.currentRoundIndex = target;
    return this.rounds[target];
  }

  /** 从某回合分支：恢复历史快照，截断后续 */
  branchFromRound(roundIndex) {
    const round = this.rounds[roundIndex];
    if (!round) return;
    this.conversationHistory = JSON.parse(JSON.stringify(round.historySnapshot));
    this.rounds = this.rounds.slice(0, roundIndex + 1);
    this.currentRoundIndex = null;
  }

  /** 当前浏览的回合编号（1-based）和总回合数 */
  getRoundInfo() {
    const total = this.rounds.length;
    const current = this.currentRoundIndex !== null
      ? this.currentRoundIndex + 1
      : total;
    return { current, total };
  }

  // ── SSE 解析 ─────────────────────────────────────────────

  parseSSELine(line) {
    if (!line.startsWith('data:')) return null;
    const jsonStr = line.slice(5).trim();
    if (jsonStr === '[DONE]') return null;
    try {
      const obj = JSON.parse(jsonStr);
      return obj?.choices?.[0]?.delta?.content ?? null;
    } catch (_) {
      return null;
    }
  }

  // ── 历史裁剪 ─────────────────────────────────────────────

  _trimHistory() {
    if (this.conversationHistory.length > MAX_HISTORY) {
      this.conversationHistory = this.conversationHistory.slice(-TRIM_TO);
    }
  }

  // ── 重置 ─────────────────────────────────────────────────

  resetGame() {
    this.stopStreaming();
    this.conversationHistory = [];
    this.configMessage = '';
    this.rounds = [];
    this.currentRoundIndex = null;
  }
}

// 全局单例
const engine = new Engine();
