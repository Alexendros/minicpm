/**
 * @module mc-kb
 * @summary Base de conocimiento: subida de documentos, lista, búsqueda y respuesta RAG (I5–I6).
 * @part toolbar Barra de título y subida.
 * @part tabs Pestañas Buscar / Responder.
 * @part results Resultados de búsqueda y respuesta.
 * @part docs Lista de documentos.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';
import { render } from '../markdown.js';

const NO_CONTEXT = 'No hay contexto suficiente';
const ACCEPT = '.txt,.md,.json,.pdf,.docx,.html,.htm';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: flex; flex-direction: column; flex: 1; min-height: 0; font-family: var(--mc-sans); color: var(--mc-text); }
  :host([hidden]) { display: none; }
  .toolbar { display: flex; align-items: center; gap: var(--mc-space-gap); padding: var(--mc-space-gap) var(--mc-space-page); }
  .title { margin: 0; font-size: var(--wa-font-size-l); font-weight: var(--wa-font-weight-semibold); flex: 1; }
  .file-input { display: none; }
  .hint { color: var(--mc-text-quiet); font-size: var(--wa-font-size-s); padding: 0 var(--mc-space-page) var(--mc-space-gap); }
  .tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; padding-inline: var(--mc-space-page); }
  .tabs::part(panel) { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--mc-space-gap); padding-block: var(--mc-space-gap); }
  .query-row { display: flex; align-items: center; gap: var(--mc-space-gap); }
  .search-input { flex: 1; }
  .results { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--mc-space-gap); }
  .empty { color: var(--mc-text-quiet); padding: var(--mc-space-gap); }
  .answer-bubble { background: var(--mc-bubble-assistant); color: var(--mc-bubble-assistant-text); border-radius: var(--mc-radius); padding: var(--mc-space-gap) var(--mc-space-page); }
  .docs { padding: 0 var(--mc-space-page) var(--mc-space-page); }
  .docs-list { display: flex; flex-direction: column; gap: var(--mc-space-gap); }
`);

export class McKb extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._docs = [];
    this._pollTimer = null;
    this._ctrl = null;
  }

  connectedCallback() {
    if (!this._wired) { this._render(); this._wire(); this._wired = true; }
    this._refreshDocs();
  }

  disconnectedCallback() {
    clearTimeout(this._pollTimer);
    this._ctrl?.abort();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <div class="toolbar" part="toolbar">
        <h2 class="title">${t('kb.title')}</h2>
        <input class="file-input" type="file" multiple accept="${ACCEPT}">
        <wa-button class="upload" size="small"><wa-icon name="upload"></wa-icon>${t('kb.upload')}</wa-button>
      </div>
      <span class="hint">${t('kb.uploadHint')}</span>
      <wa-tab-group class="tabs" part="tabs">
        <wa-tab slot="nav" panel="search">${t('kb.search')}</wa-tab>
        <wa-tab slot="nav" panel="answer">${t('kb.answer')}</wa-tab>
        <wa-tab-panel name="search">
          <div class="query-row"><wa-input class="search-input" placeholder="${t('kb.searchPlaceholder')}"><wa-icon name="magnifying-glass" slot="prefix"></wa-icon></wa-input><wa-button class="btn-search" size="small">${t('kb.search')}</wa-button></div>
          <div class="results search-results" part="results"></div>
        </wa-tab-panel>
        <wa-tab-panel name="answer">
          <wa-textarea class="query" rows="3" placeholder="${t('kb.queryPlaceholder')}"></wa-textarea>
          <div class="query-row"><wa-button class="btn-answer" size="small" variant="brand"><wa-icon name="paper-plane"></wa-icon>${t('kb.answer')}</wa-button></div>
          <div class="results answer-results" part="results"></div>
        </wa-tab-panel>
      </wa-tab-group>
      <div class="docs" part="docs"><div class="docs-list"></div></div>
    `;
    this._input = this.shadowRoot.querySelector('.file-input');
    this._uploadBtn = this.shadowRoot.querySelector('.upload');
    this._searchInput = this.shadowRoot.querySelector('.search-input');
    this._btnSearch = this.shadowRoot.querySelector('.btn-search');
    this._searchResults = this.shadowRoot.querySelector('.search-results');
    this._query = this.shadowRoot.querySelector('.query');
    this._btnAnswer = this.shadowRoot.querySelector('.btn-answer');
    this._answerResults = this.shadowRoot.querySelector('.answer-results');
    this._docsList = this.shadowRoot.querySelector('.docs-list');
  }

  _wire() {
    this._uploadBtn.addEventListener('click', () => this._input.click());
    this._input.addEventListener('change', () => { this._uploadFiles([...this._input.files]); this._input.value = ''; });
    this._btnSearch.addEventListener('click', () => this._search());
    this._btnAnswer.addEventListener('click', () => this._answer());
    this._searchInput.addEventListener('keydown', (e) => e.key === 'Enter' && this._search());
    this._query.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._answer(); } });
    this.shadowRoot.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._ctrl) { e.preventDefault(); this._ctrl.abort(); } });
    this._docsList.addEventListener('mc-delete-document', (e) => this._deleteDoc(e.detail.id));
  }

  async _refreshDocs() {
    let data;
    try { data = await api.kb.documents(); } catch { data = { documents: [] }; }
    this._docs = data.documents || [];
    this._renderDocs();
    if (this._docs.some((d) => d.status === 'indexing')) {
      clearTimeout(this._pollTimer);
      this._pollTimer = setTimeout(() => this._refreshDocs(), 2000);
    }
  }

  _renderDocs() {
    this._docsList.replaceChildren();
    if (!this._docs.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = t('kb.noDocuments');
      this._docsList.append(p);
      return;
    }
    for (const d of this._docs) {
      const row = document.createElement('mc-doc-row');
      row.setAttribute('id', d.id);
      row.setAttribute('name', d.filename);
      row.setAttribute('chunks', d.n_chunks);
      row.setAttribute('state', d.status);
      if (d.created_at) row.setAttribute('date', d.created_at);
      this._docsList.append(row);
    }
  }

  async _uploadFiles(files) {
    for (const file of files) {
      try { await api.kb.upload(file); } catch (err) {
        if (err.status === 409) window.mcToast?.show(t('kb.duplicate', { name: file.name }), { variant: 'warning' });
        else if (err.status === 413) window.mcToast?.show(t('kb.limit'), { variant: 'danger' });
        else window.mcToast?.show(err.message ?? t('status.error'), { variant: 'danger' });
      }
    }
    this._refreshDocs();
  }

  async _deleteDoc(id) {
    const doc = this._docs.find((d) => String(d.id) === String(id));
    const ok = await window.mcConfirm?.open({
      label: t('kb.confirmDeleteTitle'),
      body: t('kb.confirmDeleteBody', { name: doc?.filename ?? '' }),
      confirmLabel: t('common.delete'),
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.kb.deleteDocument(id);
      window.mcToast?.show(t('kb.deleteDoc'), { variant: 'success' });
      this._refreshDocs();
    } catch (err) {
      window.mcToast?.show(err.message ?? t('status.error'), { variant: 'danger' });
    }
  }

  async _search() {
    const q = this._searchInput.value.trim();
    if (!q) return;
    this._searchResults.replaceChildren();
    try {
      const hits = await api.kb.search(q, { top_k: 5, rerank: true });
      if (!hits.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = t('kb.noResults'); this._searchResults.append(p); return; }
      for (const hit of hits) {
        const card = document.createElement('mc-source-card');
        card.setAttribute('filename', hit.filename);
        card.setAttribute('idx', hit.chunk_idx);
        card.setAttribute('score', hit.rerank_score ?? hit.cosine);
        card.setAttribute('text', hit.text);
        this._searchResults.append(card);
      }
    } catch (err) {
      window.mcToast?.show(err.message ?? t('status.error'), { variant: 'danger' });
    }
  }

  async _answer() {
    const q = this._query.value.trim();
    if (!q) return;
    this._ctrl?.abort();
    const ctrl = new AbortController();
    this._ctrl = ctrl;
    const results = this._answerResults;
    results.replaceChildren();
    const bubble = document.createElement('div');
    bubble.className = 'answer-bubble';
    bubble.setAttribute('aria-busy', 'true');
    const body = document.createElement('div');
    bubble.append(body);
    results.append(bubble);
    let text = '';
    try {
      await api.streamRag(
        { query: q, top_k: 4, model: '8b', no_think: true, stream: true, lang: 'es' },
        {
          signal: ctrl.signal,
          onEvent: (j) => {
            if (j.type === 'sources') {
              for (const s of j.sources || []) {
                const card = document.createElement('mc-source-card');
                card.setAttribute('filename', s.filename);
                card.setAttribute('idx', s.chunk_id);
                card.setAttribute('score', s.score);
                card.setAttribute('text', s.text);
                results.insertBefore(card, bubble);
              }
            } else if (j.type === 'delta' && j.content) {
              text += j.content;
              body.replaceChildren();
              body.append(render(text));
            } else if (j.type === 'done') {
              if (j.answer && j.answer.startsWith(NO_CONTEXT)) {
                body.replaceChildren();
                const callout = document.createElement('wa-callout');
                callout.variant = 'warning';
                callout.textContent = t('kb.noContext');
                body.append(callout);
              } else if (!text && j.answer) {
                text = j.answer;
                body.replaceChildren();
                body.append(render(text));
              }
            } else if (j.type === 'error') {
              window.mcToast?.show(j.detail ?? t('status.error'), { variant: 'danger' });
            }
          },
        }
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        window.mcToast?.show(err.message ?? t('status.error'), { variant: 'danger' });
      }
    }
    bubble.setAttribute('aria-busy', 'false');
    if (this._ctrl === ctrl) this._ctrl = null;
  }
}

customElements.define('mc-kb', McKb);
