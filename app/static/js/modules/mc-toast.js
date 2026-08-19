/**
 * @module mc-toast
 * @summary Notificaciones transitorias basadas en wa-toast.
 * @attribute (sin atributos públicos)
 * @part (sin parts propios; delega en wa-toast)
 * @event (sin eventos propios; expone window.mcToast.show())
 *
 * API pública:
 *   window.mcToast.show(message, {variant, duration, icon})
 *     variant: 'brand' | 'success' | 'warning' | 'danger' | 'neutral'
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    display: block;
    position: fixed;
    inset-inline-start: 50%;
    inset-block-end: var(--mc-space-gap);
    transform: translateX(-50%);
    z-index: 2000;
  }
`);

export class McToast extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = '<wa-toast placement="bottom-center"></wa-toast>';
    this._stack = this.shadowRoot.querySelector('wa-toast');
  }

  connectedCallback() {
    window.mcToast = {
      show: (message, options = {}) => this.show(message, options),
    };
  }

  show(message, { variant = 'neutral', duration = 4000, icon } = {}) {
    const label = typeof message === 'string' && message ? message : t('toast.default');
    return this._stack.create(label, {
      variant,
      duration,
      icon: icon ?? undefined,
    });
  }
}

customElements.define('mc-toast', McToast);