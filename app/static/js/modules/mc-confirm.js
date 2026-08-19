/**
 * @module mc-confirm
 * @summary Diálogo de confirmación único basado en wa-dialog.
 * @attribute (sin atributos públicos)
 * @part (sin parts propios; delega en wa-dialog)
 * @event (sin eventos propios; expone window.mcConfirm.open())
 *
 * API pública:
 *   window.mcConfirm.open({label, body, confirmLabel, confirmVariant})
 *     → Promise<boolean>  (true = confirmar, false = cancelar/descartar)
 *   En variantes destructivas (danger) el diálogo no se cierra con overlay ni Escape.
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  .body {
    margin: 0;
    color: var(--mc-text);
    font-family: var(--mc-sans);
    white-space: pre-wrap;
  }
  .footer {
    display: flex;
    gap: var(--mc-space-gap);
    justify-content: flex-end;
  }
`);

export class McConfirm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `
      <wa-dialog withoutheader>
        <p class="body"></p>
        <div slot="footer" class="footer">
          <wa-button class="cancel" variant="neutral">${t('common.cancel')}</wa-button>
          <wa-button class="accept" variant="brand">${t('common.ok')}</wa-button>
        </div>
      </wa-dialog>
    `;
    this._dialog = this.shadowRoot.querySelector('wa-dialog');
    this._body = this.shadowRoot.querySelector('.body');
    this._cancel = this.shadowRoot.querySelector('.cancel');
    this._accept = this.shadowRoot.querySelector('.accept');
    this._resolve = null;
    this._danger = false;
    this._wire();
  }

  connectedCallback() {
    window.mcConfirm = { open: (opts) => this.open(opts) };
  }

  _wire() {
    this._cancel.addEventListener('click', () => this._finish(false));
    this._accept.addEventListener('click', () => this._finish(true));
    this._dialog.addEventListener('wa-request-close', (e) => {
      if (this._danger) e.preventDefault();
    });
    this._dialog.addEventListener('wa-after-hide', () => this._finish(false));
  }

  _finish(value) {
    if (!this._resolve) return;
    const resolve = this._resolve;
    this._resolve = null;
    this._dialog.open = false;
    resolve(value);
  }

  open({ label, body = '', confirmLabel, confirmVariant = 'brand' }) {
    if (this._resolve) this._finish(false);
    this._danger = confirmVariant === 'danger';
    this._dialog.label = label;
    this._body.textContent = body;
    this._accept.variant = confirmVariant;
    this._accept.textContent = confirmLabel || t('common.ok');
    this._dialog.open = true;
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }
}

customElements.define('mc-confirm', McConfirm);