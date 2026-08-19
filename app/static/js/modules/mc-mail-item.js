/**
 * @module mc-mail-item
 * @summary Fila de un mensaje de correo: estado leído/no leído, remitente,
 *   asunto, fecha relativa y marcador de adjuntos. Es el ítem activable de la
 *   lista de `mc-mail`.
 * @attr {String} uid — Identificador IMAP del mensaje (requerido).
 * @attr {String} folder — Carpeta del mensaje (por defecto INBOX).
 * @attr {String} from — Remitente.
 * @attr {String} subject — Asunto; si está vacío se muestra t('mail.emptySubject').
 * @attr {String} date — Fecha en formato ISO 8601 para wa-relative-time.
 * @attr {String} unread — 'true' si el mensaje no está leído.
 * @attr {Number} attachments — Número de adjuntos (0 si se omite).
 * @part list-item Fila completa con rol botón.
 * @part asunto Texto del asunto.
 * @part meta Bloque remitente y fecha.
 * @fires mc-open-mail — al activar la fila, con {uid, folder}.
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: block; }
  .item {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    width: 100%;
    padding: var(--mc-space-gap) var(--mc-space-page);
    border: 0;
    border-radius: var(--mc-radius-s);
    background: none;
    font: inherit;
    color: var(--mc-text);
    text-align: start;
    cursor: pointer;
  }
  .item:hover, .item:focus-visible {
    background: var(--mc-surface-raised);
    outline: var(--mc-focus);
    outline-offset: var(--mc-focus-offset);
  }
  .state { font-size: var(--wa-font-size-m); color: var(--wa-color-text-quiet); }
  .state[unread] { color: var(--wa-color-brand-fill-normal); }
  .meta { flex: 1; min-width: 0; }
  .from {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--mc-text);
  }
  .subject {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--mc-text-quiet);
  }
  .subject[unread] {
    color: var(--mc-text);
    font-weight: var(--wa-font-weight-semibold);
  }
  .tail { display: flex; align-items: center; gap: var(--mc-space-gap); color: var(--mc-text-quiet); }
  .tail wa-relative-time { color: var(--mc-text-quiet); }
  .attach { font-size: var(--wa-font-size-s); }
`);

export class McMailItem extends HTMLElement {
  static observedAttributes = ['uid', 'folder', 'from', 'subject', 'date', 'unread', 'attachments'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._wired = false;
  }

  connectedCallback() {
    if (!this._wired) {
      this._render();
      this._wire();
      this._wired = true;
    }
    this._renderRow();
  }

  attributeChangedCallback() {
    if (this._wired) this._renderRow();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <button class="item" part="list-item" type="button">
        <wa-icon class="state" name="envelope"></wa-icon>
        <span class="meta" part="meta">
          <span class="from" part="from"></span>
          <span class="subject" part="asunto"></span>
        </span>
        <span class="tail">
          <wa-relative-time class="when"></wa-relative-time>
          <wa-icon class="attach" name="paperclip"></wa-icon>
        </span>
      </button>
    `;
    this._btn = this.shadowRoot.querySelector('.item');
    this._icon = this.shadowRoot.querySelector('.state');
    this._from = this.shadowRoot.querySelector('.from');
    this._subject = this.shadowRoot.querySelector('.subject');
    this._time = this.shadowRoot.querySelector('.when');
    this._attach = this.shadowRoot.querySelector('.attach');
  }

  _wire() {
    this._btn.addEventListener('click', () => this._open());
    this._btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._open();
      }
    });
  }

  _open() {
    this.dispatchEvent(new CustomEvent('mc-open-mail', {
      detail: { uid: this._uid(), folder: this._folder() },
      bubbles: true,
      composed: true,
    }));
  }

  _uid() {
    const v = Number(this.getAttribute('uid'));
    return Number.isFinite(v) ? v : null;
  }

  _folder() {
    return this.getAttribute('folder') || 'INBOX';
  }

  _renderRow() {
    const unread = this.getAttribute('unread') === 'true';
    this._icon.name = unread ? 'envelope' : 'envelope-open';
    this._icon.toggleAttribute('unread', unread);
    this._from.textContent = this.getAttribute('from') || '';
    this._subject.textContent = this.getAttribute('subject') || t('mail.emptySubject');
    this._subject.toggleAttribute('unread', unread);
    const date = this.getAttribute('date');
    this._time.date = date ? new Date(date) : undefined;
    const n = Number(this.getAttribute('attachments'));
    this._attach.hidden = !(Number.isFinite(n) && n > 0);
  }
}

customElements.define('mc-mail-item', McMailItem);
