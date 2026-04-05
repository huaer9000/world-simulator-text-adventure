// ============================================================
// engine.js — LLM API 调用 + 对话历史管理 + 回合快照
// ============================================================

class Engine {
  constructor() {
    this.conversationHistory = [];
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

    const messages = [
      { role: 'system', content: getActiveSystemPrompt() },
      ...this.conversationHistory,
    ];

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
   * @param {string} historyContent  存入 conversationHistory 的精简文本（正文+记忆区）
   * @param {string} fullText        完整原始文本，存入 round snapshot 供 UI 渲染
   */
  appendAssistantMessage(historyContent, fullText) {
    if (!historyContent || !historyContent.trim()) return;

    const lastUser = [...this.conversationHistory].reverse().find(m => m.role === 'user');
    const userInput = lastUser?.content || '';

    // 历史记录只存精简版，大幅节省 token
    this.conversationHistory.push({ role: 'assistant', content: historyContent.trim() });

    if (this.currentRoundIndex !== null) {
      this.rounds = this.rounds.slice(0, this.currentRoundIndex + 1);
      this.currentRoundIndex = null;
    }

    // round snapshot 存完整文本，供 UI renderRound 使用
    this.rounds.push({
      userInput,
      assistantOutput: (fullText || historyContent).trim(),
      historySnapshot: JSON.parse(JSON.stringify(this.conversationHistory)),
    });
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
    this.rounds = [];
    this.currentRoundIndex = null;
  }
}

// 全局单例
const engine = new Engine();
