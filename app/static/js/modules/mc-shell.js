/**
 * @module mc-shell
 * @summary Orquestador de la interfaz: cabecera con estado de servicios y GPU,
 *   pestañas de navegación y paneles de módulos. Es el único módulo autorizado
 *   a mantener referencias globales al documento.
 * @attribute data-tab Persiste y restaura la pestaña activa vía sessionStorage.mcTab.
 * @part header Cabecera con marca, chips de estado y medidor de GPU.
 * @part tabs Grupo de pestañas de navegación.
 * @event mc-select-service {name} Enrutado desde un chip: activa la pestaña de servicios.
 * @event mc-open-services Activa la pestaña de servicios desde el medidor de GPU.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    min-height: var(--mc-header-h);
    padding-inline: var(--mc-space-page);
    border-bottom: var(--wa-border-width-s) solid var(--mc-surface-border);
    background: var(--mc-surface-raised);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--mc-space-gap) * 0.75);
    margin-inline-end: auto;
  }
  .brand wa-icon {
    font-size: var(--wa-font-size-xl);
    color: var(--wa-color-brand-fill-normal);
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    font-family: var(--mc-sans);
  }
  .brand-name {
    font-weight: var(--wa-font-weight-semibold);
    color: var(--mc-text);
  }
  .brand-tagline {
    font-size: var(--wa-font-size-xs);
    color: var(--mc-text-quiet);
  }
  .chips {
    display: flex;
    align-items: center;
    gap: calc(var(--mc-space-gap) * 0.5);
  }
  .tabs {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding-inline: var(--mc-space-page);
  }
  .tabs::part(panel) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 640px) {
    .header {
      flex-wrap: wrap;
      padding-block: var(--mc-space-gap);
    }
    .brand {
      margin-inline-end: 0;
    }
  }
`);

const TABS = [
  { panel: 'chat', icon: 'comments', label: 'nav.chat' },
  { panel: 'kb', icon: 'database', label: 'nav.kb' },
  { panel: 'mail', icon: 'envelope', label: 'nav.mail' },
  { panel: 'svc', icon: 'server', label: 'nav.services' },
];

export class McShell extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._chips = new Map();
    this._timers = [];
  }

  connectedCallback() {
    this.render();
    this._wire();
    this._refreshServices();
    this._refreshGpu();
    this._timers.push(setInterval(() => this._refreshServices(), 5000));
    this._timers.push(setInterval(() => this._refreshGpu(), 5000));
    requestAnimationFrame(() => {
      const saved = sessionStorage.getItem('mcTab');
      if (saved) this._activateTab(saved);
    });
  }

  disconnectedCallback() {
    for (const timer of this._timers) clearInterval(timer);
    this._timers = [];
  }

  render() {
    const tabs = TABS.map(
      (tab) =>
        `<wa-tab slot="nav" panel="${tab.panel}"><wa-icon name="${tab.icon}"></wa-icon>${t(tab.label)}</wa-tab>`,
    ).join('');
    const panels = TABS.map((tab) => `<wa-tab-panel name="${tab.panel}"></wa-tab-panel>`).join('');
    this.shadowRoot.innerHTML = `
      <header part="header" class="header">
        <span class="brand">
          <wa-icon name="microchip"></wa-icon>
          <span class="brand-text">
            <span class="brand-name">${t('app.name')}</span>
            <span class="brand-tagline">${t('app.tagline')}</span>
          </span>
        </span>
        <div class="chips" part="chips"></div>
        <mc-gpu-meter part="gpu"></mc-gpu-meter>
      </header>
      <wa-tab-group class="tabs" part="tabs">${tabs}${panels}</wa-tab-group>`;
    this._tabs = this.shadowRoot.querySelector('wa-tab-group');
    this._chipsHost = this.shadowRoot.querySelector('.chips');
    this._gpu = this.shadowRoot.querySelector('mc-gpu-meter');
    const panelsMap = new Map(
      Array.from(this.shadowRoot.querySelectorAll('wa-tab-panel')).map((el) => [el.name, el]),
    );
    const chat = document.createElement('mc-chat');
    const kb = document.createElement('mc-kb');
    const mail = document.createElement('mc-mail');
    const services = document.createElement('mc-services');
    panelsMap.get('chat').appendChild(chat);
    panelsMap.get('kb').appendChild(kb);
    panelsMap.get('mail').appendChild(mail);
    panelsMap.get('svc').appendChild(services);
    this._servicesEl = services;
    this._mailEl = mail;
  }

  _wire() {
    this._tabs.addEventListener('wa-tab-show', (e) => {
      if (e.detail && e.detail.name) {
        sessionStorage.setItem('mcTab', e.detail.name);
        if (e.detail.name === 'mail' && this._mailEl && typeof this._mailEl.refresh === 'function') {
          this._mailEl.refresh();
        }
        if (this._servicesEl && typeof this._servicesEl.setActive === 'function') {
          this._servicesEl.setActive(e.detail.name === 'svc');
        }
      }
    });
    this.shadowRoot.addEventListener('mc-select-service', (e) => {
      this._openServices(e.detail && e.detail.name);
    });
    this.shadowRoot.addEventListener('mc-open-services', () => {
      this._openServices();
    });
  }

  _openServices(name) {
    this._activateTab('svc');
    if (name && this._servicesEl && typeof this._servicesEl.focusRow === 'function') {
      this._servicesEl.focusRow(name);
    }
  }

  _activateTab(panel) {
    if (!this._tabs) return;
    const tab = this.shadowRoot.querySelector(`wa-tab[panel="${panel}"]`);
    if (tab) {
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
  }

  async _refreshServices() {
    try {
      const services = await api.services.list();
      this._updateChips(services);
    } catch {
      this._updateChips({});
    }
  }

  _updateChips(services) {
    const seen = new Set(Object.keys(services));
    for (const [name, data] of Object.entries(services)) {
      seen.add(name);
      let chip = this._chips.get(name);
      if (!chip) {
        chip = document.createElement('mc-status-chip');
        chip.setAttribute('name', name);
        this._chipsHost.appendChild(chip);
        this._chips.set(name, chip);
      }
      chip.setAttribute('state', (data && data.state) || 'stopped');
    }
    for (const [name, chip] of this._chips) {
      if (!seen.has(name)) {
        chip.remove();
        this._chips.delete(name);
      }
    }
  }

  async _refreshGpu() {
    try {
      const gpu = await api.services.gpu();
      if (!gpu) {
        this._gpu.removeAttribute('used');
        return;
      }
      this._gpu.setAttribute('name', gpu.name || '');
      this._gpu.setAttribute('used', String(gpu.used_mib ?? ''));
      this._gpu.setAttribute('total', String(gpu.total_mib ?? ''));
      this._gpu.setAttribute('util', String(gpu.util_pct ?? ''));
    } catch {
      this._gpu.removeAttribute('used');
    }
  }
}

customElements.define('mc-shell', McShell);