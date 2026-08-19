/**
 * @module mc-doc-list
 * @summary Lista de documentos de la base de conocimiento: subida, borrado y sondeo (I5–I6).
 * @part toolbar Barra de subida.
 * @part docs Lista de documentos.
 * @event mc-docs-changed — tras refrescar la lista, con {count}.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
  }
  .file-input { display: none; }
  .count { color: var(--mc-text-quiet); font-size: 0.875rem; }
  .docs {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--mc-space-gap);
    padding: 0 var(--mc-space-page) var(--mc-space-gap);
  }
  .docs .empty { color: var(--mc-text-quiet); padding: var(--mc-space-gap); }
`);

export class McDocList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._docs = [];
    this._pollTimer = null;
  }

  connectedCallback() {
    if (!this._wired) {
      this._render();
      this._wire();
      this._wired = true;
    }
    this._refresh();
  }

  get count() {
    return this._docs.length;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <div class="toolbar" part="toolbar">
        <input class="file-input" type="file" multiple
          accept=".txt,.md,.json,.pdf,.docx,.html,.htm">
        <wa-button class="upload" variant="neutral" size="small">
          <wa-icon name="upload"></wa-icon>
          ${t('kb.upload')}
        </wa-button>
        <span class="count" part="count"></span>
      </div>
      <div class="docs" part="docs"></div>
    `;
    this._input = this.shadowRoot.querySelector('.file-input');
    this._count = this.shadowRoot.querySelector('.count');
    this._docsEl = this.shadowRoot.querySelector('.docs');
  }

  _wire() {
    this._uploadBtn = this.shadowRoot.querySelector('.upload');
    this._uploadBtn.addEventListener('click', () => this._input.click());
    this._input.addEventListener('change', () => {
      this._uploadFiles([...this._input.files]);
      this._input.value = '';
    });
    this._docsEl.addEventListener('mc-delete-doc', (e) => this._deleteDoc(e.detail.id));
  }

  async _refresh() {
    let data;
    try {
      data = await api.kb.documents();
    } catch {
      data = { documents: [] };
    }
    this._docs = data.documents || [];
    this._count.textContent = t('kb.docCount', { n: this._docs.length });
    this._docsEl.replaceChildren();
    if (!this._docs.length) {
      const p = document.createElement('p');
      p.setAttribute('class', 'empty');
      p.textContent = t('kb.empty');
      this._docsEl.append(p);
    } else {
      for (const d of this._docs) {
        const row = document.createElement('mc-doc-row');
        row.setAttribute('id', d.id);
        row.setAttribute('name', d.filename);
        row.setAttribute('status', d.status);
        row.setAttribute('nchunks', d.n_chunks);
        if (d.created_at) row.setAttribute('created', d.created_at);
        this._docsEl.append(row);
      }
    }
    this.dispatchEvent(new CustomEvent('mc-docs-changed', {
      detail: { count: this._docs.length },
      bubbles: true,
      composed: true,
    }));
    if (this._docs.some((d) => d.status === 'indexing')) {
      clearTimeout(this._pollTimer);
      this._pollTimer = setTimeout(() => this._refresh(), 2000);
    }
  }

  async _uploadFiles(files) {
    for (const file of files) {
      try {
        await api.kb.upload(file);
      } catch (err) {
        const status = err.status;
        if (status === 409) {
          window.mcToast?.show(t('kb.duplicate', { name: file.name }), { variant: 'warning' });
        } else if (status === 413) {
          window.mcToast?.show(t('kb.limit'), { variant: 'danger' });
        } else {
          window.mcToast?.show(err.message ?? t('status.error'), { variant: 'danger' });
        }
      }
    }
    this._refresh();
  }

  async _deleteDoc(id) {
    const doc = this._docs.find((d) => d.id === id);
    const ok = await window.mcConfirm?.open({
      label: t('kb.confirmDeleteTitle'),
      body: t('kb.confirmDeleteBody', { name: doc?.filename ?? '' }),
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.kb.deleteDocument(id);
      this._refresh();
    } catch (err) {
      window.mcToast?.show(err.message ?? t('status.error'), { variant: 'danger' });
    }
  }
}

customElements.define('mc-doc-list', McDocList);