/**
 * @module mc-chat
 * @summary Conversación con el modelo: sesiones, modelo y composer (I1–I4).
 * @attribute {String} model — Modelo activo ('8b' por defecto, '5-1b').
 * @part header Barra de selectores; @part log Contenedor de mensajes;
 * @part composer Área de entrada; @part drawer Panel lateral de sesiones.
 * @fires mc-open-services — «Ir a Servicios» con el modelo parado.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';
import { render } from '../markdown.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
:host{display:flex;flex-direction:column;flex:1;min-height:0;font-family:var(--mc-sans);color:var(--mc-text)}
[hidden]{display:none!important}
.header{display:flex;align-items:center;gap:var(--mc-space-gap);flex-wrap:wrap;padding:var(--mc-space-gap) var(--mc-space-page)}
.title{font-weight:var(--wa-font-weight-semibold)}
.grow{margin-inline-end:auto}
.callout{margin:0 var(--mc-space-page)}
.log{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:var(--mc-space-gap);padding:var(--mc-space-gap) var(--mc-space-page)}
.bubble{max-width:min(78%,46rem);padding:var(--mc-space-gap) var(--mc-space-page);border-radius:var(--mc-radius);line-height:1.5;overflow-wrap:anywhere}
.bubble.user{align-self:flex-end;background:var(--mc-bubble-user);color:var(--mc-bubble-user-text)}
.bubble.assistant{align-self:flex-start;background:var(--mc-bubble-assistant);color:var(--mc-bubble-assistant-text)}
.reasoning{margin-bottom:var(--mc-space-gap)}
.reasoning-body{white-space:pre-wrap;font-family:var(--mc-mono);font-size:var(--wa-font-size-s);color:var(--mc-text-quiet)}
.composer{display:flex;align-items:flex-end;gap:var(--mc-space-gap);border-top:var(--wa-border-width-s) solid var(--mc-surface-border);padding:var(--mc-space-gap) var(--mc-space-page);min-height:var(--mc-composer-min-h)}
.composer wa-textarea{flex:1}
.status{display:inline-flex;align-items:center;gap:calc(var(--mc-space-gap)*.5);color:var(--mc-text-quiet);font-size:var(--wa-font-size-s)}
.drawer-list{display:flex;flex-direction:column;gap:var(--mc-space-gap)}
.srow{display:flex;align-items:center;gap:var(--mc-space-gap);padding:var(--mc-space-gap);border:var(--wa-border-width-s) solid var(--mc-surface-border);border-radius:var(--mc-radius);cursor:pointer}
.sname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sempty{color:var(--mc-text-quiet)}
`);

class Bubble {
  constructor(host, role, busy) {
    this.el = document.createElement('article');
    this.el.className = `bubble ${role}`;
    this.el.setAttribute('part', 'bubble');
    if (role === 'assistant') {
      this.el.setAttribute('aria-busy', busy ? 'true' : 'false');
      this.el.innerHTML = '<div class="content"><div class="answer"></div></div>';
      this.answer = this.el.querySelector('.answer');
    }
    host.append(this.el);
  }
  setText(text) { if (this.answer) this.answer.textContent = text; else this.el.textContent = text; }
  setMarkdown(text) { this.answer.replaceChildren(); this.answer.append(render(text)); }
  addReasoning(text) {
    let details = this.el.querySelector('.reasoning');
    if (!details) {
      details = document.createElement('wa-details');
      details.className = 'reasoning';
      details.summary = t('chat.think');
      const body = document.createElement('div');
      body.className = 'reasoning-body';
      details.append(body);
      this.el.querySelector('.content').prepend(details);
      details._body = body;
    }
    details._body.textContent += text;
  }
  setBusy(on) { this.el.setAttribute('aria-busy', on ? 'true' : 'false'); }
}

export class McChat extends HTMLElement {
  static observedAttributes = ['model'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._sessionId = null;
    this._model = '8b';
    this._streaming = false;
    this._ctrl = null;
    this._sessions = [];
  }

  connectedCallback() { if (!this._wired) { this._render(); this._wire(); this._wired = true; this._init(); } }

  attributeChangedCallback(name, _old, value) {
    if (name === 'model' && value) {
      this._model = ['5-1b', '8b'].includes(value) ? value : '8b';
      if (this._modelSelect) this._modelSelect.value = this._model;
    }
  }

  _render() {
    this.shadowRoot.innerHTML = `
<div class="header" part="header"><span class="title">${t('chat.title')}</span><span class="grow"></span>
<wa-select class="model" part="model" label="${t('chat.modelLabel')}"></wa-select>
<wa-switch class="think" part="think" checked>${t('chat.think')}</wa-switch>
<wa-button class="new" part="new" size="small" title="${t('chat.newSession')}"><wa-icon name="plus"></wa-icon></wa-button>
<wa-button class="sessions" part="sessions" size="small" title="${t('chat.sessions')}"><wa-icon name="comments"></wa-icon></wa-button></div>
<wa-callout class="callout" part="callout" variant="warning" hidden><span class="callout-msg"></span><wa-button class="go-svc" size="small">${t('chat.goServices')}</wa-button></wa-callout>
<div class="log" part="log" role="log" aria-live="polite"></div>
<div class="composer" part="composer">
<wa-textarea class="input" part="textarea" rows="1" resize="auto" placeholder="${t('chat.placeholder')}"></wa-textarea>
<span class="status" part="status" hidden><wa-spinner></wa-spinner>${t('chat.streaming')}</span>
<wa-button class="send" part="send" variant="brand" title="${t('chat.send')}"><wa-icon name="paper-plane"></wa-icon></wa-button>
<wa-button class="stop" part="stop" variant="neutral" title="${t('chat.stop')}" hidden><wa-icon name="stop"></wa-icon></wa-button></div>
<wa-drawer class="drawer" part="drawer" label="${t('chat.sessions')}"><div class="drawer-list" part="session-list"></div></wa-drawer>`;
    this._modelSelect = this.shadowRoot.querySelector('.model');
    this._think = this.shadowRoot.querySelector('.think');
    this._callout = this.shadowRoot.querySelector('.callout');
    this._calloutMsg = this.shadowRoot.querySelector('.callout-msg');
    this._log = this.shadowRoot.querySelector('.log');
    this._input = this.shadowRoot.querySelector('.input');
    this._status = this.shadowRoot.querySelector('.status');
    this._send = this.shadowRoot.querySelector('.send');
    this._stop = this.shadowRoot.querySelector('.stop');
    this._drawer = this.shadowRoot.querySelector('.drawer');
    this._drawerList = this.shadowRoot.querySelector('.drawer-list');
    for (const name of ['5-1b', '8b']) {
      const opt = document.createElement('wa-option');
      opt.value = name;
      opt.textContent = name;
      this._modelSelect.append(opt);
    }
    this._modelSelect.value = this._model;
  }

  _wire() {
    this._modelSelect.addEventListener('change', () => { this._model = this._modelSelect.value; });
    this._send.addEventListener('click', () => this._sendMessage());
    this._stop.addEventListener('click', () => this._abort());
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendMessage(); }
      else if (e.key === 'Escape' && this._streaming) { e.preventDefault(); this._abort(); }
    });
    this.shadowRoot.querySelector('.new').addEventListener('click', () => this._newSession());
    this.shadowRoot.querySelector('.sessions').addEventListener('click', () => this._openSessions());
    this.shadowRoot.querySelector('.go-svc').addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('mc-open-services', { bubbles: true, composed: true })));
    this._drawerList.addEventListener('click', (e) => {
      const del = e.target.closest('.del');
      if (del) { this._deleteSession(this._sessions.find((s) => s.id === Number(del.dataset.id))); return; }
      const row = e.target.closest('.srow');
      if (row) this._selectSession(Number(row.dataset.id));
    });
    this._drawerList.addEventListener('keydown', (e) => {
      const row = e.target.closest?.('.srow');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this._selectSession(Number(row.dataset.id)); }
    });
  }

  _toast(err) { window.mcToast?.show(`${t('chat.errorPrefix')}: ${err?.message ?? err}`, { variant: 'danger' }); }

  async _init() {
    let sessions = [];
    try { sessions = await api.sessions.list(); } catch { /* sin servidor */ }
    const stored = Number(sessionStorage.getItem('mcSessionId'));
    if (stored && sessions.some((s) => s.id === stored)) { this._sessionId = stored; await this._paintSession(stored); }
    else if (sessions.length) { this._sessionId = sessions[0].id; sessionStorage.setItem('mcSessionId', String(this._sessionId)); await this._paintSession(this._sessionId); }
  }

  async _sendMessage() {
    const text = this._input.value.trim();
    if (!text || this._streaming) return;
    this._callout.hidden = true;
    let services = {};
    try { services = await api.services.list(); } catch { services = {}; }
    const svc = services[this._model];
    if (!svc || svc.state !== 'running') { this._calloutMsg.textContent = t('chat.notRunning', { model: this._model }); this._callout.hidden = false; return; }
    if (!this._sessionId) {
      try { const created = await api.sessions.create(); this._sessionId = created.id; sessionStorage.setItem('mcSessionId', String(this._sessionId)); }
      catch (err) { this._toast(err); return; }
    }
    this._input.value = '';
    this._addUser(text);
    const bubble = this._addAssistant(true);
    this._setStreaming(true);
    const ctrl = new AbortController();
    this._ctrl = ctrl;
    let answer = '';
    try {
      await api.streamChat({
        model: this._model,
        messages: [{ role: 'user', content: text }],
        no_think: !this._think.checked,
        session_id: this._sessionId,
      }, {
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.type === 'delta' && e.content) { answer += e.content; bubble.setMarkdown(answer); }
          else if (e.type === 'reasoning' && e.content && this._model === '8b') bubble.addReasoning(e.content);
        },
      });
    } catch (err) { if (err.name !== 'AbortError') this._toast(err); }
    if (!answer) bubble.setText(t('chat.empty'));
    bubble.setBusy(false);
    this._setStreaming(false);
    this._ctrl = null;
    this._refreshSessions();
  }

  _setStreaming(on) { this._streaming = on; this._send.disabled = on; this._stop.hidden = !on; this._status.hidden = !on; this._log.setAttribute('aria-busy', on ? 'true' : 'false'); }

  _abort() { this._ctrl?.abort(); }
  _addUser(text) { const b = new Bubble(this._log, 'user'); b.setText(text); this._scrollEnd(); return b; }
  _addAssistant(busy) { const b = new Bubble(this._log, 'assistant', busy); this._scrollEnd(); return b; }
  _scrollEnd() { this._log.scrollTop = this._log.scrollHeight; }

  async _paintSession(id) {
    this._log.replaceChildren();
    try {
      const data = await api.sessions.get(id);
      for (const m of data.messages || []) {
        if (m.role === 'user') this._addUser(m.content);
        else if (m.role === 'assistant') {
          const b = this._addAssistant(false);
          if (m.reasoning_content) b.addReasoning(m.reasoning_content);
          b.setMarkdown(m.content || t('chat.empty'));
        }
      }
    } catch (err) { this._toast(err); }
  }

  async _newSession() { if (this._streaming) this._abort(); this._log.replaceChildren(); try { const created = await api.sessions.create(); this._sessionId = created.id; sessionStorage.setItem('mcSessionId', String(this._sessionId)); } catch (err) { this._toast(err); } this._refreshSessions(); }

  async _openSessions() {
    let sessions = [];
    try { sessions = await api.sessions.list(); } catch { sessions = []; }
    this._sessions = sessions;
    this._drawerList.innerHTML = sessions.length
      ? sessions.map((s) => `<div class="srow" role="button" tabindex="0" data-id="${s.id}"><span class="sname">${s.name}</span><wa-button class="del" size="small" variant="neutral" title="${t('chat.deleteSession')}" data-id="${s.id}"><wa-icon name="trash"></wa-icon></wa-button></div>`).join('')
      : `<div class="sempty">${t('chat.noSession')}</div>`;
    this._drawer.open = true;
  }

  async _selectSession(id) { if (this._streaming) this._abort(); this._drawer.open = false; this._sessionId = id; sessionStorage.setItem('mcSessionId', String(id)); await this._paintSession(id); }

  async _deleteSession(s) {
    const ok = await window.mcConfirm?.open({ label: t('chat.confirmDeleteTitle'), body: t('chat.confirmDeleteBody', { name: s?.name ?? '', n: s?.n_messages ?? 0 }), confirmLabel: t('common.delete'), confirmVariant: 'danger' });
    if (!ok) return;
    try { await api.sessions.del(s.id); if (this._sessionId === s.id) { this._sessionId = null; sessionStorage.removeItem('mcSessionId'); this._log.replaceChildren(); } await this._openSessions(); }
    catch (err) { this._toast(err); }
  }

  async _refreshSessions() {
    try { const sessions = await api.sessions.list(); if (this._sessionId && !sessions.some((s) => s.id === this._sessionId)) { this._sessionId = null; sessionStorage.removeItem('mcSessionId'); } }
    catch { /* silencioso */ }
  }
}

customElements.define('mc-chat', McChat);