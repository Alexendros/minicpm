/**
 * @module mc-session-bar
 * @summary Selector de conversaciones: cambiar, crear y eliminar (I1–I4).
 * @part sessions Selector de conversaciones.
 * @event mc-session-change — {id} al elegir, crear o eliminar una conversación.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
  }
  wa-select {
    min-width: 12rem;
  }
`);

export class McSessionBar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `
      <wa-select class="sessions" part="sessions" label="${t('session.label')}"></wa-select>
      <wa-button class="new-session" title="${t('session.new')}" size="small">
        <wa-icon name="plus"></wa-icon>
      </wa-button>
      <wa-button class="del-session" title="${t('session.delete')}" size="small">
        <wa-icon name="trash"></wa-icon>
      </wa-button>
    `;
    this._select = this.shadowRoot.querySelector('.sessions');
    this._newBtn = this.shadowRoot.querySelector('.new-session');
    this._delBtn = this.shadowRoot.querySelector('.del-session');
    this._sessions = [];
    this._value = null;
    this._wire();
  }

  get value() {
    return this._value;
  }

  get sessions() {
    return this._sessions;
  }

  _emit(id) {
    this.dispatchEvent(
      new CustomEvent('mc-session-change', { detail: { id }, bubbles: true, composed: true })
    );
  }

  _wire() {
    this._select.addEventListener('change', () => {
      this._value = Number(this._select.value);
      this._emit(this._value);
    });
    this._newBtn.addEventListener('click', () => this.newSession());
    this._delBtn.addEventListener('click', () => this.deleteSession());
  }

  _renderOptions() {
    this._select.replaceChildren();
    for (const s of this._sessions) {
      const opt = document.createElement('wa-option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      this._select.append(opt);
    }
    this._select.value = this._value != null ? String(this._value) : '';
  }

  async init() {
    let sessions = [];
    try {
      sessions = await api.sessions.list();
    } catch {
      /* sin servidor: se reintentará al refrescar */
    }
    if (!sessions.length) {
      try {
        sessions = [await api.sessions.create()];
      } catch {
        /* silencioso */
      }
    }
    this._sessions = sessions;
    this._value = sessions.length ? sessions[0].id : null;
    this._renderOptions();
    return this._value;
  }

  select(id) {
    if (!this._sessions.some((s) => s.id === id)) return;
    this._value = id;
    this._renderOptions();
    this._emit(id);
  }

  async refresh() {
    try {
      const sessions = await api.sessions.list();
      if (!sessions.length) return;
      this._sessions = sessions;
      if (!sessions.some((s) => s.id === this._value)) {
        this._value = sessions[0].id;
        this._emit(this._value);
      }
      this._renderOptions();
    } catch {
      /* silencioso */
    }
  }

  async newSession() {
    try {
      const created = await api.sessions.create();
      this._sessions.unshift(created);
      this._value = created.id;
      this._renderOptions();
      this._emit(created.id);
      return created.id;
    } catch {
      window.mcToast?.show(t('session.errorPrefix'), { variant: 'danger' });
      return null;
    }
  }

  async deleteSession() {
    if (this._value == null) return;
    const s = this._sessions.find((x) => x.id === this._value);
    const ok = await window.mcConfirm?.open({
      label: t('session.confirmDeleteTitle'),
      body: t('session.confirmDeleteBody', { name: s?.name ?? '', n: s?.n_messages ?? 0 }),
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.sessions.del(this._value);
      let sessions = await api.sessions.list();
      if (!sessions.length) sessions = [await api.sessions.create()];
      this._sessions = sessions;
      this._value = sessions[0].id;
      this._renderOptions();
      this._emit(this._value);
    } catch {
      window.mcToast?.show(t('session.errorPrefix'), { variant: 'danger' });
    }
  }
}

customElements.define('mc-session-bar', McSessionBar);