// ============================================================
// ui.js — UI 渲染、流式、侧边栏结构化解析
// ============================================================

class GameUI {
  constructor() {
    this.outputInner   = document.getElementById('output-inner');
    this.outputArea    = document.getElementById('output-area');
    this.cursor        = document.getElementById('cursor');
    this.actionButtons = document.getElementById('action-buttons');
    this.playerInput   = document.getElementById('player-input');
    this.submitBtn     = document.getElementById('submit-btn');
    this.sidebarInner  = document.getElementById('sidebar-inner');

    this.isStreaming   = false;
    this._currentBlock = null;
    this._streamBuffer = '';
  }

  // ── 消息追加 ─────────────────────────────────────────────

  appendUserMessage(text) {
    const shouldStick = this._shouldStickToBottom();
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.textContent = '> ' + text;
    this.outputInner.appendChild(div);
    this.scrollToBottom(shouldStick);
  }

  startAssistantBlock() {
    const shouldStick = this._shouldStickToBottom();
    this._currentBlock = document.createElement('div');
    this._currentBlock.className = 'msg-ai';
    this.outputInner.appendChild(this._currentBlock);
    this._streamBuffer = '';
    this.outputInner.appendChild(this.cursor);
    this.cursor.style.display = 'inline';
    this.scrollToBottom(shouldStick);
    return this._currentBlock;
  }

  appendToken(token) {
    if (!this._currentBlock) this.startAssistantBlock();
    const shouldStick = this._shouldStickToBottom();
    this._streamBuffer += token;
    this._currentBlock.innerHTML = this._formatGameText(this._streamBuffer);
    this.scrollToBottom(shouldStick);
  }

  onStreamEnd() {
    this.cursor.style.display = 'none';
    const fullText = this._streamBuffer;
    this._currentBlock = null;
    this._streamBuffer = '';

    const sections = this._parseSections(fullText);

    const mainBlock = this.outputInner.lastElementChild;
    if (mainBlock && mainBlock.classList.contains('msg-ai')) {
      mainBlock.innerHTML = this._formatGameText(sections.main || fullText);
    }

    this._renderSidebar(sections.panels);
    this._renderActionButtons(this._parseActionButtons(fullText));

    // 只有用户本来就在底部时才跟随滚动，避免打断阅读
    this.scrollToBottom(this._shouldStickToBottom());
    return fullText;
  }

  appendSystemMessage(text, isError = false) {
    const shouldStick = this._shouldStickToBottom();
    const div = document.createElement('div');
    div.className = isError ? 'msg-system msg-error' : 'msg-system';
    div.textContent = text;
    this.outputInner.appendChild(div);
    this.scrollToBottom(shouldStick);
  }

  // ── 流式读取 ─────────────────────────────────────────────

  async streamResponse(response) {
    this.startAssistantBlock();
    const reader  = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let partial   = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        partial += decoder.decode(value, { stream: true });
        const lines = partial.split('\n');
        partial = lines.pop();
        for (const line of lines) {
          const tok = engine.parseSSELine(line.trim());
          if (tok) this.appendToken(tok);
        }
      }
      if (partial.trim()) {
        const tok = engine.parseSSELine(partial.trim());
        if (tok) this.appendToken(tok);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.appendSystemMessage('⚠️ 响应中断：' + err.message, true);
      }
    }

    const fullText = this.onStreamEnd();
    engine.appendAssistantMessage(fullText);
    return fullText;
  }

  // ── 分区解析 ──────────────────────────────────────────────
  // 支持多种分隔符：— (U+2014)、─ (U+2500)、- (U+002D)，2个或更多

  _sectionDelimRe() {
    return /[-—─]{2,}\s*[【\[]([^\]】]{1,30})[】\]]\s*[-—─]{2,}/g;
  }

  _sectionHeaderLineRe() {
    return /^\s*[【\[]([^\]】]{1,30})[】\]]\s*$/;
  }

  _parseSections(text) {
    const delimRe = this._sectionDelimRe();
    const inlineHeaderRe = this._sectionHeaderLineRe();
    const parts   = [];
    let lastIndex = 0;
    let lastTitle = null;
    let match;

    while ((match = delimRe.exec(text)) !== null) {
      if (lastTitle !== null) {
        parts.push({ title: lastTitle, content: text.slice(lastIndex, match.index).trim() });
      }
      lastTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastTitle !== null) {
      parts.push({ title: lastTitle, content: text.slice(lastIndex).trim() });
    }

    if (parts.length === 0) {
      const lines = text.split('\n');
      let currentTitle = null;
      let buffer = [];
      const inlineParts = [];

      const pushCurrent = () => {
        if (!currentTitle) return;
        inlineParts.push({
          title: currentTitle,
          content: buffer.join('\n').trim(),
        });
        currentTitle = null;
        buffer = [];
      };

      lines.forEach(line => {
        const m = line.match(inlineHeaderRe);
        if (m) {
          pushCurrent();
          currentTitle = m[1].trim();
        } else if (currentTitle) {
          buffer.push(line);
        }
      });

      pushCurrent();

      if (!inlineParts.length) return { main: text, panels: [] };

      parts.push(...inlineParts);
    }

    const SIDEBAR  = ['游戏面板', '玩家面板', '记忆区'];
    const SKIP     = ['行动建议'];
    let main = '';
    const panels = [];

    for (const part of parts) {
      const t = part.title;
      if (SKIP.some(s => t.includes(s))) continue;
      if (t === '正文') {
        main = part.content;
      } else if (this._isSidebarPanel(t, part.content, SIDEBAR)) {
        panels.push({ title: t, content: part.content });
      } else {
        main += (main ? '\n\n' : '') + part.content;
      }
    }

    // fallback：没有 【正文】 节时取第一个非侧边栏节
    if (!main) {
      const fb = parts.find(p =>
        !['游戏面板','玩家面板','记忆区'].some(s => p.title.includes(s)) &&
        !p.title.endsWith('面板') &&
        !['行动建议'].some(s => p.title.includes(s))
      );
      if (fb) main = fb.content;
    }

    return { main, panels };
  }

  _isSidebarPanel(title, content, sidebarTitles = ['游戏面板', '玩家面板', '记忆区']) {
    if (sidebarTitles.some(s => title.includes(s))) return true;
    if (title.endsWith('面板')) return true;

    const npcSignals = [
      /数值面板[：:]/,
      /情绪[：:]/,
      /心声[：:]/,
      /外貌[：:]/,
      /性格[：:]/,
      /⚧️/,
      /好感[：:]\s*\d+\/\d+/,
      /欲望[：:]\s*\d+\/\d+/,
      /警惕[：:]\s*\d+\/\d+/,
    ];

    return npcSignals.some(re => re.test(content));
  }

  // ── 侧边栏主渲染 ─────────────────────────────────────────

  _renderSidebar(panels) {
    if (!panels || !panels.length) return;
    this.sidebarInner.innerHTML = '';

    panels.forEach(({ title, content }) => {
      const section  = document.createElement('div');
      section.className = 'sidebar-section';
      const panelTheme = this._detectPanelTheme(title, content);
      if (panelTheme !== 'neutral') {
        section.classList.add(`sidebar-section-${panelTheme}`);
      }

      const titleEl = document.createElement('div');
      titleEl.className = 'sidebar-section-title';
      titleEl.textContent = title;
      section.appendChild(titleEl);

      const body = document.createElement('div');
      body.className = 'sidebar-section-body';

      if (title.includes('记忆区')) {
        body.appendChild(this._renderMemory(content));
      } else {
        body.appendChild(this._renderFields(content, panelTheme));
      }

      section.appendChild(body);
      this.sidebarInner.appendChild(section);
    });
  }

  _detectPanelTheme(title, content) {
    if (title.includes('玩家面板')) return 'neutral';
    if (/⚧️\s*男/.test(content)) return 'male';
    if (/⚧️\s*女/.test(content)) return 'female';
    return 'neutral';
  }

  // ── 结构化字段渲染 ───────────────────────────────────────

  _renderFields(content, panelTheme = 'neutral') {
    const wrap  = document.createElement('div');
    wrap.className = 'panel-fields';
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    lines.forEach(line => {
      // ① 数值面板行  📖数值面板:❤️好感:75/100 | 🔥欲望:20/100 ｜💕阶段:暧昧
      if (line.includes('数值面板')) {
        const inner = line.replace(/^.*?数值面板[：:]\s*/, '');
        wrap.appendChild(this._renderStatRow(inner));
        return;
      }

      // ② 体能/精力  💪体能:75/100 | ⚡️精力:60/100
      if (/体能[：:]\d+\/\d+/.test(line) || /精力[：:]\d+\/\d+/.test(line)) {
        wrap.appendChild(this._renderStatRow(line));
        return;
      }

      // ③ 性格标签  🏷️ 性格:温柔、体贴、含羞
      if (/性格[：:]/.test(line)) {
        const idx = line.search(/[：:]/);
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (/[、,，]/.test(value)) {
          wrap.appendChild(this._renderBadgeRow(label, value));
          return;
        }
      }

      if (/亲近异性[：:]/.test(line)) {
        return;
      }

      // ④ 无冒号但有竖线（基本信息行）  ⚧️ 女 | 🎂 30岁 | 💼 全职主妇
      if (!/[：:]/.test(line) && /[|｜]/.test(line)) {
        wrap.appendChild(this._renderPillRow(line));
        return;
      }

      if (/身体特征[：:]/.test(line)) {
        wrap.appendChild(this._renderBodyFeatureRow(line, panelTheme));
        return;
      }

      // ⑤ 普通 标签:值 行
      wrap.appendChild(this._renderFieldRow(line));
    });

    return wrap;
  }

  // 普通字段行
  _renderFieldRow(line) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    const m = line.match(/^(.+?)[：:]\s*(.+)$/s);
    if (m) {
      const lbl = document.createElement('span');
      lbl.className = 'panel-row-label';
      lbl.textContent = m[1];
      const val = document.createElement('span');
      val.className = 'panel-row-value';
      val.textContent = m[2];
      row.appendChild(lbl);
      row.appendChild(val);
    } else {
      row.textContent = line;
    }
    return row;
  }

  _renderBodyFeatureRow(line, panelTheme) {
    const wrap = document.createElement('div');
    wrap.className = `body-feature-row body-feature-${panelTheme}`;

    const idx = line.search(/[：:]/);
    const label = document.createElement('div');
    label.className = 'body-feature-label';
    label.textContent = idx >= 0 ? line.slice(0, idx).trim() : '身体特征';
    wrap.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'body-feature-grid';

    const raw = idx >= 0 ? line.slice(idx + 1).trim() : line;
    raw.split(/[|｜]/).map(part => part.trim()).filter(Boolean).forEach(part => {
      const item = document.createElement('div');
      item.className = 'body-feature-item';

      const m = part.match(/^(.+?)[：:]\s*(.+)$/);
      if (m) {
        const itemLabel = document.createElement('span');
        itemLabel.className = 'body-feature-item-label';
        itemLabel.textContent = m[1].trim();
        const itemValue = document.createElement('span');
        itemValue.className = 'body-feature-item-value';
        itemValue.textContent = m[2].trim();
        item.appendChild(itemLabel);
        item.appendChild(itemValue);
      } else {
        item.textContent = part;
      }

      grid.appendChild(item);
    });

    wrap.appendChild(grid);
    return wrap;
  }

  // 竖线分隔的药丸行（基本信息）
  _renderPillRow(line) {
    const row = document.createElement('div');
    row.className = 'panel-pill-row';
    line.split(/[|｜]/).map(p => p.trim()).filter(Boolean).forEach(part => {
      const pill = document.createElement('span');
      pill.className = 'panel-pill';
      pill.textContent = part;
      row.appendChild(pill);
    });
    return row;
  }

  // 标签 badge 行（性格）
  _renderBadgeRow(label, value) {
    const wrap = document.createElement('div');
    wrap.className = 'panel-badge-row';
    if (label) {
      const lbl = document.createElement('div');
      lbl.className = 'panel-badge-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
    }
    const badges = document.createElement('div');
    badges.className = 'panel-badges';
    value.split(/[、,，]/).map(t => t.trim()).filter(Boolean).forEach(tag => {
      const b = document.createElement('span');
      b.className = 'panel-badge';
      b.textContent = tag;
      badges.appendChild(b);
    });
    wrap.appendChild(badges);
    return wrap;
  }

  // 数值条行（解析 "❤️好感:75/100 | 🔥欲望:20/100 ｜💕阶段:暧昧"）
  _renderStatRow(text) {
    const wrap = document.createElement('div');
    wrap.className = 'panel-stats';
    text.split(/[|｜]/).map(p => p.trim()).filter(Boolean).forEach(part => {
      const m = part.match(/(.+?)[：:]\s*(\d+)\/(\d+)/);
      if (m) {
        wrap.appendChild(this._renderStatBar(m[1].trim(), +m[2], +m[3]));
      } else {
        // 非数字部分，如 "💕阶段:暧昧"
        const sm = part.match(/(.+?)[：:]\s*(.+)/);
        if (sm) {
          const row = document.createElement('div');
          row.className = 'panel-stat-text';
          const lbl = document.createElement('span');
          lbl.className = 'stat-text-label';
          const labelText = sm[1].trim() === '💕阶段' ? '💕关系' : sm[1].trim();
          lbl.textContent = labelText;
          const val = document.createElement('span');
          val.className = 'stat-text-value';
          val.textContent = sm[2].trim();
          row.appendChild(lbl);
          row.appendChild(val);
          wrap.appendChild(row);
        }
      }
    });
    return wrap;
  }

  // 单条数值进度条
  _renderStatBar(label, val, max, colorHint) {
    if (!colorHint) colorHint = this._statColor(label);
    const pct = Math.min(100, Math.max(0, (val / (max || 100)) * 100));

    const row   = document.createElement('div');
    row.className = 'stat-row';

    const lbl   = document.createElement('span');
    lbl.className = 'stat-label';
    lbl.textContent = label;

    const track = document.createElement('div');
    track.className = 'stat-track';
    const fill  = document.createElement('div');
    fill.className = `stat-fill stat-${colorHint}`;
    fill.style.width = pct + '%';
    track.appendChild(fill);

    const num   = document.createElement('span');
    num.className = 'stat-value';
    num.textContent = val;

    row.appendChild(lbl);
    row.appendChild(track);
    row.appendChild(num);
    return row;
  }

  _statColor(label) {
    if (label.includes('好感') || label.includes('❤')) return 'love';
    if (label.includes('欲望') || label.includes('🔥')) return 'desire';
    if (label.includes('体能') || label.includes('💪')) return 'stamina';
    if (label.includes('精力') || label.includes('⚡')) return 'energy';
    return 'default';
  }

  // ── 记忆区渲染 ────────────────────────────────────────────

  _renderMemory(content) {
    const wrap = document.createElement('div');
    wrap.className = 'memory-container';

    let currentHeader  = null;
    let currentEntries = [];

    const flush = () => {
      if (!currentHeader && !currentEntries.length) return;
      const group = document.createElement('div');
      group.className = 'memory-group';

      if (currentHeader) {
        const h = document.createElement('div');
        h.className = 'memory-group-header';
        h.textContent = currentHeader;
        group.appendChild(h);
      }

      currentEntries.forEach(entry => {
        const el = document.createElement('div');
        el.className = 'memory-entry';
        if (entry.startsWith('🔥'))      el.classList.add('memory-key');
        else if (entry.startsWith('📜')) el.classList.add('memory-long');
        else if (entry.startsWith('🔸')) el.classList.add('memory-short');
        el.textContent = entry;
        group.appendChild(el);
      });

      if (group.children.length) wrap.appendChild(group);
      currentHeader  = null;
      currentEntries = [];
    };

    content.split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      // 分组标题：关键事件 X/50 / 长期记忆 X/8 / 短期记忆 X/7
      if (/^(关键事件|长期记忆|短期记忆)/.test(line)) {
        flush();
        currentHeader = line;
      } else if (line.startsWith('🔥') || line.startsWith('📜') || line.startsWith('🔸')) {
        currentEntries.push(line);
      } else {
        currentEntries.push(line);
      }
    });

    flush();

    if (!wrap.children.length) {
      const empty = document.createElement('div');
      empty.className = 'memory-empty';
      empty.textContent = '暂无记忆记录';
      wrap.appendChild(empty);
    }

    return wrap;
  }

  // ── 行动建议 ─────────────────────────────────────────────

  _parseActionButtons(text) {
    // 使用宽松分隔符匹配【行动建议】节
    const secRe    = /【行动建议】[^\n]*\n([\s\S]*?)(?:[-—─]{2,}|$)/;
    const secMatch = text.match(secRe);
    if (!secMatch) return [];

    const options  = [];
    const lineRe   = /^([A-D])[.．、]\s*(.+)/gm;
    let m;
    while ((m = lineRe.exec(secMatch[1])) !== null) {
      const raw = m[2].trim();
      if (/^自定义行动/.test(raw)) continue;
      options.push({ key: m[1], text: raw });
    }
    return options;
  }

  _renderActionButtons(options) {
    this.actionButtons.innerHTML = '';
    if (!options.length) {
      this.actionButtons.classList.add('hidden');
      return;
    }
    this.actionButtons.classList.remove('hidden');
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      // 剥除 markdown 符号，保留纯文字
      const clean = opt.text
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
      btn.innerHTML = `<span class="action-key">${opt.key}.</span><span class="action-text">${this._escapeHtml(clean)}</span>`;
      btn.addEventListener('click', () => {
        this.playerInput.value = `${opt.key}. ${opt.text}`;
        this.playerInput.focus();
        document.getElementById('submit-btn').click();
      });
      this.actionButtons.appendChild(btn);
    });
  }

  // ── 文本格式化（支持 Markdown） ───────────────────────────

  /**
   * 渲染行内 Markdown：***加粗斜体*** / **加粗** / *斜体* / `代码`
   * 输入为普通文本（未转义），内部自行转义再处理
   */
  _renderInline(text) {
    let s = this._escapeHtml(text);
    s = s.replace(/\*\*\*(.+?)\*\*\*/g,  '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g,       '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/`([^`\n]+)`/g,         '<code class="md-code">$1</code>');
    return s;
  }

  /**
   * 把 LLM 输出的全文转换为 HTML，逐行处理：
   * 分隔线标题 / ATX 标题 / 横线 / 无序列表 / 普通行
   */
  _formatGameText(text) {
    return text.split('\n').map(line => {
      const t = line.trim();

      // 分隔线标题：——【X】——（各种破折号变体）
      if (/[-—─]{2,}\s*[【\[]([^\]】]+)[】\]]\s*[-—─]{2,}/.test(t)) {
        const m = t.match(/[【\[]([^\]】]+)[】\]]/);
        const title = m ? this._escapeHtml(m[1]) : this._escapeHtml(t);
        return `<span class="section-header">——【${title}】——</span>`;
      }

      // ATX 标题：# / ## / ###
      const hm = t.match(/^(#{1,3})\s+(.+)$/);
      if (hm) {
        return `<span class="md-h${hm[1].length}">${this._renderInline(hm[2])}</span>`;
      }

      // 横线：--- / *** / ___（3个以上相同字符）
      if (/^([-*_])\1{2,}$/.test(t)) {
        return '<span class="md-hr"></span>';
      }

      // 无序列表：- item / * item（行首可有缩进）
      const lm = line.match(/^[ \t]*[-*]\s+(.+)$/);
      if (lm) {
        return `<span class="md-li">${this._renderInline(lm[1])}</span>`;
      }

      // 普通行
      return this._renderInline(line);
    }).join('<br>');
  }

  _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── 回合重绘 ──────────────────────────────────────────────

  renderRound(round) {
    this.outputInner.innerHTML = '';
    this.actionButtons.innerHTML = '';
    this.actionButtons.classList.add('hidden');
    this.cursor.style.display = 'none';

    if (round.userInput) this.appendUserMessage(round.userInput);

    const sections = this._parseSections(round.assistantOutput);

    const div = document.createElement('div');
    div.className = 'msg-ai';
    div.innerHTML = this._formatGameText(sections.main || round.assistantOutput);
    this.outputInner.appendChild(div);

    if (sections.panels.length) this._renderSidebar(sections.panels);
    this._renderActionButtons(this._parseActionButtons(round.assistantOutput));
    this.scrollToBottom();
  }

  // ── 工具方法 ─────────────────────────────────────────────

  _shouldStickToBottom() {
    const threshold = 36;
    return this.outputArea.scrollHeight - this.outputArea.scrollTop - this.outputArea.clientHeight < threshold;
  }

  scrollToBottom(force = false) {
    if (force) this.outputArea.scrollTop = this.outputArea.scrollHeight;
  }

  setLoading(loading) {
    this.submitBtn.disabled = false;
    this.submitBtn.classList.toggle('submit-stop', loading);
    this.submitBtn.innerHTML = loading ? '<span class="stop-icon" aria-hidden="true"></span>' : '发送';
    if (!loading) this.playerInput.focus();
  }

  clearOutput() {
    this.outputInner.innerHTML = '';
    this.actionButtons.innerHTML = '';
    this.actionButtons.classList.add('hidden');
    this.cursor.style.display = 'none';
    this.sidebarInner.innerHTML = '<div class="sidebar-placeholder">游戏面板将在首次 AI 回复后显示</div>';
  }

  renderHistory(history) {
    this.clearOutput();
    history.forEach(msg => {
      if (msg.role === 'user') {
        this.appendUserMessage(msg.content);
      } else if (msg.role === 'assistant') {
        const sections = this._parseSections(msg.content);
        const div = document.createElement('div');
        div.className = 'msg-ai';
        div.innerHTML = this._formatGameText(sections.main || msg.content);
        this.outputInner.appendChild(div);
        if (sections.panels.length) this._renderSidebar(sections.panels);
      }
    });
    const lastAI = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAI) this._renderActionButtons(this._parseActionButtons(lastAI.content));
    this.scrollToBottom();
  }
}

let ui;
