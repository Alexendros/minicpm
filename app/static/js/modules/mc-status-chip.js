/**
 * @module mc-status-chip
 * @summary Chip compacto de estado de un servicio (header del shell).
 * @attribute name  — nombre del servicio (5-1b, 8b, embed, rerank)
 * @attribute state — running | starting | error | stopped
 * @part chip  — contenedor principal (botón)
 * @part icon  — wa-icon de estado
 * @part name  — nombre del servicio
 * @part label — texto del estado
 * @event mc-select-service — {name} al hacer clic o pulsar Enter/Espacio
 *
 * Estados: running=success (circle-check), starting=warning (circle-notch giro),
 *          error=danger (circle-xmark), stopped=neutral (circle).
 * Iconos self-hosted bajo /static/vendor/webawesome/icons/solid/.
 */
import { t } from '../i18n.js';

const ICONS = {
  running: 'circle-check',
  starting: 'circle-notch',
  error: 'circle-xmark',
  stopped: 'circle',
};

const VARIANTS = {
  running: 'success',
  starting: 'warning',
  error: 'danger',
  stopped: 'neutral',
};

const styles = new CSSStyleSheet();
styles.replaceSync(`
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--mc-space-gap);
    height: var(--mc-chip-h);
    padding-inline: calc(var(--mc-space-gap) + 0.125rem);
    border: var(--wa-border-width-s) solid var(--mc-surface-border);
    border-radius: var(--wa-border-radius-pill);
    background: var(--mc-surface-raised);
    color: var(--mc-text);
    font-family: var(--mc-sans);
    font-size: var(--wa-font-size-s);
    line-height: 1;
    cursor: pointer;
    user-select: none;
  }
  .chip:hover {
    border-color: var(--wa-color-brand-border-hover);
    box-shadow: 0 0 0 var(--wa-focus-ring-offset) transparent;
  }
  .chip:focus-visible {
    outline: none;
    box-shadow: var(--mc-focus) var(--wa-color-brand-fill-normal);
  }
  .chip.success { color: var(--wa-color-success-fill-normal); }
  .chip.warning { color: var(--wa-color-warning-fill-normal); }
  .chip.danger { color: var(--wa-color-danger-fill-normal); }
  .chip.neutral { color: var(--wa-color-text-quiet); }
  .spin { animation: mc-status-spin 0.9s linear infinite; }
  @keyframes mc-status-spin { to { transform: rotate(360deg); } }
`);

export class McStatusChip extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'state'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `
      <button type="button" class="chip neutral" part="chip" role="status">
        <wa-icon part="icon" style="font-size: var(--wa-font-size-m);"></wa-icon>
        <span part="name"></span>
        <span part="label"></span>
      </button>
    `;
    this._button = this.shadowRoot.querySelector('.chip');
    this._icon = this.shadowRoot.querySelector('wa-icon');
    this._name = this.shadowRoot.querySelector('[part="name"]');
    this._label = this.shadowRoot.querySelector('[part="label"]');
    this._button.addEventListener('click', () => this._select());
    this._button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._select();
      }
    });
  }

  get name() {
    return this.getAttribute('name') || '';
  }

  get state() {
    return this.getAttribute('state') || 'stopped';
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const state = this.state;
    const variant = VARIANTS[state] || 'neutral';
    this._button.className = `chip ${variant}`;
    this._icon.name = ICONS[state] || 'circle';
    this._icon.classList.toggle('spin', state === 'starting');
    this._name.textContent = this.name;
    this._label.textContent = t(`status.${state}`) || state;
    this._button.setAttribute('aria-label', `${this.name}: ${this._label.textContent}`);
    this._button.title = this.name;
  }

  _select() {
    this.dispatchEvent(
      new CustomEvent('mc-select-service', {
        detail: { name: this.name },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('mc-status-chip', McStatusChip);