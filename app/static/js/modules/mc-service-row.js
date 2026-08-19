/**
 * @module mc-service-row
 * @summary Fila de un servicio: icono, nombre, device/model, estado, uptime,
 *   tokens/s y acción iniciar/detener. No ejecuta acciones: emite un evento
 *   compuesto para que mc-services las lleve a cabo.
 * @attr {string} name        — nombre del servicio ('5-1b', '8b', 'embed', 'rerank')
 * @attr {string} state       — running | starting | error | stopped
 * @attr {number} uptime_s    — segundos en marcha (running)
 * @attr {number} tokens_per_s— tokens/segundo (solo LLM)
 * @attr {string} device      — 'cpu' | 'gpu' (de /api/meta)
 * @attr {string} model       — etiqueta del modelo (de /api/meta)
 * @attr {boolean} selected   — marca la fila como enfocada
 * @part row    — contenedor de la fila
 * @part status — wa-badge de estado
 * @part button — botón de acción iniciar/detener
 * @event mc-control-service — {name, action:'start'|'stop'} al pulsar el botón
 *
 * Estados: running=success (circle-check), starting=warning (circle-notch giro),
 *          error=danger (circle-xmark), stopped=neutral (circle).
 */
import { t } from '../i18n.js';

const SERVICE_ICON = {
  '5-1b': 'gauge-high',
  '8b': 'microchip',
  embed: 'database',
  rerank: 'arrows-rotate',
};

const STATE = {
  running: { variant: 'success', icon: 'circle-check', text: () => t('status.running') },
  starting: { variant: 'warning', icon: 'circle-notch', text: () => t('status.starting') },
  error: { variant: 'danger', icon: 'circle-xmark', text: () => t('status.error') },
  stopped: { variant: 'neutral', icon: 'circle', text: () => t('status.stopped') },
};

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: block; }
  .row {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
    border: var(--wa-border-width-s) solid var(--mc-surface-border);
    border-radius: var(--mc-radius-s);
    background: var(--mc-surface-raised);
  }
  :host([selected]) .row {
    border-color: var(--wa-color-brand-fill-normal);
    box-shadow: var(--mc-focus) var(--wa-color-brand-fill-normal);
  }
  .svc-icon {
    font-size: var(--wa-font-size-l);
    color: var(--wa-color-brand-fill-normal);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }
  .name {
    font-weight: var(--wa-font-weight-semibold);
    color: var(--mc-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: calc(var(--mc-space-gap) * 0.5);
    color: var(--mc-text-quiet);
    font-size: var(--wa-font-size-xs);
  }
  .meta .mono { font-family: var(--mc-mono); font-variant-numeric: tabular-nums; }
  .status { flex: none; }
  .info {
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    color: var(--mc-text-quiet);
    font-size: var(--wa-font-size-xs);
  }
  .info .mono { font-family: var(--mc-mono); font-variant-numeric: tabular-nums; }
  .spin { animation: mc-service-spin 0.9s linear infinite; }
  @keyframes mc-service-spin { to { transform: rotate(360deg); } }
`);

export class McServiceRow extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'state', 'uptime_s', 'tokens_per_s', 'device', 'model', 'selected'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `
      <div class="row" part="row">
        <wa-icon class="svc-icon" part="icon"></wa-icon>
        <div class="main">
          <span class="name" part="name"></span>
          <span class="meta" part="meta">
            <span class="device"></span>
            <span class="model"></span>
          </span>
        </div>
        <wa-badge class="status" part="status">
          <wa-icon class="state-icon"></wa-icon>
          <span class="state-text"></span>
        </wa-badge>
        <div class="info" part="info">
          <span class="uptime mono"></span>
          <span class="tps mono"></span>
        </div>
        <wa-button class="action" part="button" size="small"></wa-button>
      </div>
    `;
    this._icon = this.shadowRoot.querySelector('.svc-icon');
    this._name = this.shadowRoot.querySelector('.name');
    this._device = this.shadowRoot.querySelector('.device');
    this._model = this.shadowRoot.querySelector('.model');
    this._badge = this.shadowRoot.querySelector('.status');
    this._stateIcon = this.shadowRoot.querySelector('.state-icon');
    this._stateText = this.shadowRoot.querySelector('.state-text');
    this._uptime = this.shadowRoot.querySelector('.uptime');
    this._tps = this.shadowRoot.querySelector('.tps');
    this._action = this.shadowRoot.querySelector('.action');
    this._action.addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit();
    });
  }

  get name() {
    return this.getAttribute('name') || '';
  }

  attributeChangedCallback() {
    this._render();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent('mc-control-service', {
        detail: { name: this.name, action: this._actionAction },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _render() {
    const state = this.getAttribute('state') || 'stopped';
    const conf = STATE[state] || STATE.stopped;
    this._icon.name = SERVICE_ICON[this.name] || 'server';
    this._name.textContent = this.name;
    const device = this.getAttribute('device');
    const model = this.getAttribute('model');
    this._device.textContent = device ? (device === 'gpu' ? 'GPU' : 'CPU') : '';
    this._model.textContent = device && model ? `· ${model}` : model || '';
    this._badge.variant = conf.variant;
    this._stateIcon.name = conf.icon;
    this._stateIcon.classList.toggle('spin', state === 'starting');
    this._stateText.textContent = conf.text();
    this._badge.setAttribute('aria-label', `${this.name}: ${conf.text()}`);

    const uptime = Number(this.getAttribute('uptime_s'));
    this._uptime.textContent =
      state === 'running' && uptime > 0
        ? t('services.uptime') + ' ' + this._fmt(uptime)
        : '';

    const tps = Number(this.getAttribute('tokens_per_s'));
    this._tps.textContent = state === 'running' && tps > 0
      ? t('services.tokensPerSec', { n: tps.toFixed(1) })
      : '';

    const running = state === 'running';
    const busy = state === 'starting';
    this._actionAction = running ? 'stop' : 'start';
    this._action.variant = running ? 'danger' : 'brand';
    this._action.textContent = running ? t('services.stop') : t('services.start');
    this._action.disabled = busy;
  }

  _fmt(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }
}

customElements.define('mc-service-row', McServiceRow);
