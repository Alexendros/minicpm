/**
 * @module mc-gpu-meter
 * @summary Medidor de VRAM del header basado en wa-progress-bar.
 * @attribute used  — MiB usados (ausente → "GPU no disponible")
 * @attribute total — MiB totales
 * @attribute util  — porcentaje de uso (0-100)
 * @attribute name  — nombre de la GPU
 * @part bar   — contenedor del wa-progress-bar
 * @part label — bloque de texto (nombre + valores)
 * @part warn  — estado de advertencia cuando uso > --mc-meter-warn (0.85)
 * @event mc-open-services — al hacer clic (navega a la pestaña Servicios)
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    min-width: 12rem;
  }
  .meter {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    border: var(--wa-border-width-s) solid transparent;
    border-radius: var(--mc-radius-m);
    padding: calc(var(--mc-space-gap) * 0.5);
    cursor: pointer;
    transition: border-color var(--mc-motion) var(--mc-ease);
  }
  .meter:focus-visible {
    outline: none;
    box-shadow: var(--mc-focus) var(--wa-color-brand-fill-normal);
  }
  .meter:hover {
    border-color: var(--mc-surface-border);
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 6rem;
    font-family: var(--mc-sans);
    font-size: var(--wa-font-size-xs);
    line-height: 1.2;
  }
  .name { color: var(--mc-text-quiet); }
  .vals { color: var(--mc-text); }
  .warn .vals { color: var(--wa-color-warning-fill-normal); }
  .unavailable { color: var(--mc-text-quiet); }
`);

export class McGpuMeter extends HTMLElement {
  static get observedAttributes() {
    return ['used', 'total', 'util', 'name'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `
      <div part="bar" class="meter" role="button" tabindex="0">
        <wa-progress-bar value="0"></wa-progress-bar>
        <div part="label" class="label">
          <span class="name"></span>
          <span class="vals"></span>
        </div>
      </div>
    `;
    this._meter = this.shadowRoot.querySelector('.meter');
    this._bar = this.shadowRoot.querySelector('wa-progress-bar');
    this._name = this.shadowRoot.querySelector('.name');
    this._vals = this.shadowRoot.querySelector('.vals');
    this._meter.addEventListener('click', () => this._open());
    this._meter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._open();
      }
    });
  }

  attributeChangedCallback() {
    this._render();
  }

  get used() {
    return this.getAttribute('used');
  }

  _open() {
    this.dispatchEvent(
      new CustomEvent('mc-open-services', { bubbles: true, composed: true }),
    );
  }

  _render() {
    const used = this.used;
    if (used === null || used === undefined) {
      this._name.textContent = '';
      this._vals.textContent = t('gpu.unavailable');
      this._meter.classList.add('unavailable');
      this._meter.classList.remove('warn');
      this._bar.value = 0;
      this._bar.setAttribute('aria-hidden', 'true');
      return;
    }
    this._meter.classList.remove('unavailable');
    const total = Number(this.getAttribute('total') || 0);
    const util = Number(this.getAttribute('util') || 0);
    const usedNum = Number(used);
    const ratio = total > 0 ? usedNum / total : util / 100;
    const warn = ratio > Number(getComputedStyle(this).getPropertyValue('--mc-meter-warn') || 0.85);
    this._meter.classList.toggle('warn', warn);
    this._bar.value = Math.max(0, Math.min(100, util || (total > 0 ? ratio * 100 : 0)));
    this._name.textContent = this.getAttribute('name') || t('gpu.label');
    this._vals.textContent = t('gpu.used', { used: usedNum, total }) + (util ? ` · ${t('gpu.util', { pct: util })}` : '');
  }
}

customElements.define('mc-gpu-meter', McGpuMeter);