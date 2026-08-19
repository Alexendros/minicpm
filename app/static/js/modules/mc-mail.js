/**
 * @module mc-mail
 * @summary Panel de correo: estado del bridge, configuración, lista de
 *   mensajes, detalle y redacción. Criterios I7 (bridge caído → callout) e I12
 *   (descartar borrador sucio con confirmación).
 * @part mail Contenedor principal.
 * @part toolbar Selector de carpeta y acciones.
 * @part list Lista de mensajes.
 * @part detail Detalle del mensaje (split-panel ≥ 900 px / drawer < 900 px).
 * @part compose Diálogo de redacción.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: flex; flex: 1; min-height: 0; flex-direction: column; }
  .mail {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
  }
  .mail[hidden], .mail > [hidden] { display: none; }
  .bridge, .login { display: flex; flex-direction: column; gap: var(--mc-space-gap); align-items: flex-start; }
  .login-fields { display: flex; flex-wrap: wrap; gap: var(--mc-space-gap); }
  .login-error { margin: 0; color: var(--wa-color-danger-fill-normal); font-size: var(--wa-font-size-s); }
  .toolbar { display: flex; align-items: center; gap: var(--mc-space-gap); }
  .toolbar .grow { margin-inline-end: auto; }
  wa-split-panel { flex: 1; min-height: 0; }
  .list { display: flex; flex-direction: column; gap: var(--mc-space-gap); overflow-y: auto; }
  .list .empty { color: var(--mc-text-quiet); padding: var(--mc-space-gap); }
  .detail-host { display: flex; flex: 1; min-height: 0; }
  @media (max-width: 899px) { .detail-host { display: none; } }
`);

export class McMail extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._folder = 'INBOX';
    this._wired = false;
    this._poll = null;
    this._lastItem = null;
  }

  connectedCallback() {
    if (!this._wired) {
      this._render();
      this._wire();
      this._wired = true;
    }
    this._observer = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      this._setPolling(visible);
    });
    this._observer.observe(this);
    this.refresh();
  }

  disconnectedCallback() {
    this._setPolling(false);
    this._observer?.disconnect();
  }

  _setPolling(active) {
    if (active && !this._poll) {
      this._poll = setInterval(() => this.refresh(), 60000);
    } else if (!active && this._poll) {
      clearInterval(this._poll);
      this._poll = null;
    }
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <div class="mail" part="mail">
        <wa-callout class="bridge" part="bridge" variant="danger" hidden>
          <span class="bridge-msg"></span>
          <wa-button class="retry" size="small">${t('mail.retry')}</wa-button>
        </wa-callout>
        <div class="login" part="login" hidden>
          <div class="login-fields">
            <wa-input class="user" label="${t('mail.user')}"></wa-input>
            <wa-input class="pass" label="${t('mail.password')}" type="password"></wa-input>
          </div>
          <p class="login-error" part="login-error" hidden></p>
          <wa-button class="login-btn" variant="brand">${t('mail.login')}</wa-button>
        </div>
        <div class="app" hidden>
          <div class="toolbar" part="toolbar">
            <wa-select class="folder" part="folder" label="${t('mail.folders')}"></wa-select>
            <span class="grow"></span>
            <wa-button class="compose" size="small">${t('mail.compose.open')}</wa-button>
            <wa-button class="refresh" size="small">${t('mail.refresh')}</wa-button>
          </div>
          <wa-split-panel part="split">
            <div class="list" part="list" slot="start"></div>
            <div class="detail-host" slot="end"></div>
          </wa-split-panel>
        </div>
        <wa-drawer class="detail-drawer" label="${t('mail.newMessage')}">
          <div class="drawer-body"></div>
        </wa-drawer>
        <mc-mail-compose class="compose" part="compose"></mc-mail-compose>
      </div>
    `;
    this._bridge = this.shadowRoot.querySelector('.bridge');
    this._bridgeMsg = this.shadowRoot.querySelector('.bridge-msg');
    this._login = this.shadowRoot.querySelector('.login');
    this._loginError = this.shadowRoot.querySelector('.login-error');
    this._app = this.shadowRoot.querySelector('.app');
    this._folderSel = this.shadowRoot.querySelector('.folder');
    this._list = this.shadowRoot.querySelector('.list');
    this._split = this.shadowRoot.querySelector('wa-split-panel');
    this._detailHost = this.shadowRoot.querySelector('.detail-host');
    this._drawer = this.shadowRoot.querySelector('.detail-drawer');
    this._drawerBody = this.shadowRoot.querySelector('.drawer-body');
    this._compose = this.shadowRoot.querySelector('.compose');
    this._detail = document.createElement('mc-mail-detail');
  }

  _wire() {
    this.shadowRoot.querySelector('.retry').addEventListener('click', () => this.refresh());
    this.shadowRoot.querySelector('.login-btn').addEventListener('click', () => this._login());
    this.shadowRoot.querySelector('.compose').addEventListener('click', () => this._compose.open());
    this.shadowRoot.querySelector('.refresh').addEventListener('click', () => this.refresh());
    this._folderSel.addEventListener('change', () => {
      this._folder = this._folderSel.value;
      this._loadList();
    });
    this._list.addEventListener('mc-open-mail', (e) => this._openMessage(e.detail, e.target));
    this._detail.addEventListener('mc-reply', (e) => this._replyTo(e.detail.msg));
    this._drawer.addEventListener('wa-after-hide', () => {
      this._lastItem?.focus();
      this._lastItem = null;
    });
    const split = Number(getComputedStyle(this).getPropertyValue('--mc-split-mail'));
    if (Number.isFinite(split)) this._split.position = split;
  }

  async refresh() {
    let status = {};
    try {
      status = await api.mail.status();
    } catch {
      status = { bridge_up: false, configured: false };
    }
    const up = !!status.bridge_up;
    this._bridge.hidden = up;
    this._bridgeMsg.textContent = t('mail.bridgeDown');
    this._login.hidden = up ? !!status.configured : true;
    this._app.hidden = !(up && status.configured);
    if (!(up && status.configured)) return;
    try {
      const f = await api.mail.folders();
      this._folderSel.replaceChildren();
      for (const name of f.folders || []) {
        const opt = document.createElement('wa-option');
        opt.value = name;
        opt.textContent = name;
        this._folderSel.append(opt);
      }
      this._folderSel.value = this._folder;
    } catch {
      /* sin carpetas */
    }
    this._loadList();
  }

  async _loadList() {
    this._list.replaceChildren();
    let data = { count: 0, messages: [] };
    try {
      data = await api.mail.unread({ folder: this._folder, limit: 50 });
    } catch {
      window.mcToast?.show(t('mail.bridgeDown'), { variant: 'danger' });
    }
    for (const m of data.messages || []) {
      const item = document.createElement('mc-mail-item');
      for (const [k, v] of Object.entries({ uid: m.uid, folder: this._folder, from: m.from || '', subject: m.subject || '' })) {
        item.setAttribute(k, String(v));
      }
      if (m.date) item.setAttribute('date', m.date);
      item.setAttribute('unread', 'true');
      if (m.attachments?.length) item.setAttribute('attachments', String(m.attachments.length));
      this._list.append(item);
    }
    if (!(data.messages || []).length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = t('mail.noMessages');
      this._list.append(p);
    }
  }

  async _login() {
    const user = this.shadowRoot.querySelector('.user').value.trim();
    const pass = this.shadowRoot.querySelector('.pass').value;
    if (!user || !pass) return;
    this._loginError.hidden = true;
    try {
      await api.mail.config({ user, password: pass });
      this.refresh();
    } catch (err) {
      this.shadowRoot.querySelector('.pass').value = '';
      if (err.status === 401) {
        this._loginError.textContent = err.message || t('mail.bridgeDown');
        this._loginError.hidden = false;
      } else {
        window.mcToast?.show(err.message ?? t('mail.bridgeDown'), { variant: 'danger' });
      }
    }
  }

  async _openMessage({ uid, folder }, item) {
    let msg = null;
    try {
      msg = await api.mail.fetch(uid, folder);
    } catch {
      window.mcToast?.show(t('mail.bridgeDown'), { variant: 'danger' });
      return;
    }
    this._detail.render(msg, { uid, folder });
    if (window.matchMedia('(min-width: 900px)').matches) {
      this._detailHost.replaceChildren(this._detail);
    } else {
      this._lastItem = item;
      this._drawerBody.replaceChildren(this._detail);
      this._drawer.open = true;
    }
    try { await api.mail.mark({ uid, read: true, folder }); } catch { /* opcional */ }
    this._loadList();
  }

  _replyTo(msg) {
    this._compose.open({
      to: msg.from || '',
      subject: msg.subject ? `Re: ${msg.subject}` : '',
      in_reply_to: msg.in_reply_to || null,
      references: msg.references || null,
    });
  }
}

customElements.define('mc-mail', McMail);
