/**
 * @module mc-doc-row
 * @summary Fila de un documento de la base de conocimiento.
 * @attr {String} id — Identificador del documento.
 * @attr {String} name — Nombre del fichero.
 * @attr {Number} chunks — Número de fragmentos.
 * @attr {String} state — 'indexing' | 'ready' | 'error'.
 * @attr {String} date — Fecha de creación ISO.
 * @part row Contenedor de la fila.
 * @part icon Icono del tipo de fichero.
 * @part name Nombre del fichero.
 * @part meta Metadatos (fragmentos y fecha).
 * @part badge Insignia de estado.
 * @fires mc-delete-document {id} — al pulsar borrar; el contenedor ejecuta el borrado.
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: block; }
  .row {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
    border-radius: var(--mc-radius-s);
    background: var(--mc-surface-raised);
  }
  .icon { color: var(--mc-text-quiet); }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    flex: 1;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--wa-font-weight-semibold);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    color: var(--mc-text-quiet);
    font-size: var(--wa-font-size-s);
  }
  .meta wa-relative-time { font-variant-numeric: tabular-nums; }
`);

const TEXT_EXT = ['txt', 'md', 'json', 'docx', 'html', 'htm'];

export class McDocRow extends HTMLElement {
  static observedAttributes = ['id', 'name', 'chunks', 'state', 'date'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
  }

  connectedCallback() {
    if (!this._wired) {
      this.shadowRoot.innerHTML = `
        <div class="row" part="row">
          <wa-icon class="icon" part="icon"></wa-icon>
          <div class="info">
            <span class="name" part="name"></span>
            <span class="meta" part="meta"></span>
          </div>
          <wa-badge class="badge" part="badge"></wa-badge>
          <wa-button class="delete" part="delete" size="small" variant="danger"
            title="${t('kb.delete')}">
            <wa-icon name="trash"></wa-icon>
          </wa-button>
        </div>
      `;
      this._icon = this.shadowRoot.querySelector('.icon');
      this._name = this.shadowRoot.querySelector('.name');
      this._meta = this.shadowRoot.querySelector('.meta');
      this._badge = this.shadowRoot.querySelector('.badge');
      this.shadowRoot.querySelector('.delete').addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('mc-delete-document', {
          detail: { id: this.getAttribute('id') },
          bubbles: true,
          composed: true,
        }));
      });
      this._wired = true;
    }
    this._render();
  }

  attributeChangedCallback() {
    if (this._wired) this._render();
  }

  _render() {
    if (!this._name) return;
    const name = this.getAttribute('name') || '';
    this._name.textContent = name;
    this._name.title = name;
    const ext = (name.split('.').pop() || '').toLowerCase();
    this._icon.name = TEXT_EXT.includes(ext) ? 'file-lines' : 'file';
    const n = Number(this.getAttribute('chunks') || 0);
    const meta = [t('kb.chunks', { n })];
    const date = this.getAttribute('date');
    if (date) {
      const time = document.createElement('wa-relative-time');
      time.date = new Date(date);
      meta.push(time);
    }
    this._meta.replaceChildren(...meta);
    const state = this.getAttribute('state') || 'ready';
    const variant = state === 'ready' ? 'success' : state === 'error' ? 'danger' : 'warning';
    this._badge.variant = variant;
    this._badge.textContent =
      state === 'indexing' ? t('kb.indexing') : state === 'ready' ? t('kb.ready') : t('kb.error');
  }
}

customElements.define('mc-doc-row', McDocRow);
