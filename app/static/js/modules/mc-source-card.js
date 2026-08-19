/**
 * @module mc-source-card
 * @summary Tarjeta de una fuente RAG: documento, fragmento y puntuación.
 * @attr {String} filename — Documento de origen.
 * @attr {Number} idx — Índice del fragmento.
 * @attr {Number} score — Puntuación (cosine o rerank), 3 decimales.
 * @attr {String} text — Texto del fragmento (máx. 4 líneas).
 * @part card Contenedor de la fuente.
 * @part name Nombre del documento.
 * @part meta Metadatos del fragmento.
 * @part text Cuerpo del fragmento.
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: block; }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
    border-radius: var(--mc-radius-s);
    background: var(--mc-surface-raised);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--wa-font-weight-semibold);
  }
  .meta {
    color: var(--mc-text-quiet);
    font-size: var(--wa-font-size-s);
    font-variant-numeric: tabular-nums;
  }
  .text {
    color: var(--mc-text);
    font-size: var(--wa-font-size-s);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`);

export class McSourceCard extends HTMLElement {
  static observedAttributes = ['filename', 'idx', 'score', 'text'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
  }

  connectedCallback() {
    if (!this._wired) {
      this.shadowRoot.innerHTML = `
        <div class="card" part="card">
          <div class="head">
            <span class="name" part="name"></span>
            <span class="meta" part="meta"></span>
            <wa-badge class="score" variant="neutral"></wa-badge>
          </div>
          <span class="text" part="text"></span>
        </div>
      `;
      this._name = this.shadowRoot.querySelector('.name');
      this._meta = this.shadowRoot.querySelector('.meta');
      this._score = this.shadowRoot.querySelector('.score');
      this._text = this.shadowRoot.querySelector('.text');
      this._wired = true;
    }
    this._render();
  }

  attributeChangedCallback() {
    if (this._wired) this._render();
  }

  _render() {
    if (!this._name) return;
    this._name.textContent = this.getAttribute('filename') || '';
    const idx = this.getAttribute('idx');
    const parts = [];
    if (idx != null && idx !== '') parts.push(`#${idx}`);
    const meta = parts.join(' · ');
    this._meta.textContent = meta;
    const score = this.getAttribute('score');
    this._score.textContent = score != null && score !== '' ? Number(score).toFixed(3) : '';
    this._text.textContent = this.getAttribute('text') || '';
  }
}

customElements.define('mc-source-card', McSourceCard);
