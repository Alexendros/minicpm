/**
 * @module mc-mail-detail
 * @summary Detalle de un mensaje: cabecera, cuerpo plano y adjuntos (I7).
 * @part detail Contenedor del detalle.
 * @fires mc-reply — al pulsar Responder, con {msg}.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host { display: flex; flex: 1; min-height: 0; flex-direction: column; }
  .detail {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
  }
  .head { display: flex; flex-wrap: wrap; gap: var(--mc-space-gap); align-items: baseline; }
  .subject { font-weight: 600; font-size: 1.05rem; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .meta { color: var(--mc-text-quiet); font-size: 0.875rem; }
  .body { white-space: pre-wrap; font-family: var(--mc-mono); font-size: 0.9rem; line-height: 1.5; }
  .attach { display: flex; flex-wrap: wrap; gap: var(--mc-space-gap); align-items: center; }
`);

export class McMailDetail extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `<div class="detail" part="detail"></div>`;
    this._detail = this.shadowRoot.querySelector('.detail');
  }

  render(msg, { uid, folder }) {
    const head = document.createElement('div');
    head.className = 'head';
    const subject = document.createElement('span');
    subject.className = 'subject';
    subject.textContent = msg.subject || t('mail.emptySubject');
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${msg.from} · ${msg.to || ''}`;
    head.append(subject, meta);

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = msg.body || '';

    const actions = document.createElement('div');
    actions.className = 'attach';
    const reply = document.createElement('wa-button');
    reply.size = 'small';
    reply.textContent = t('mail.reply');
    reply.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('mc-reply', { detail: { msg }, bubbles: true, composed: true })));
    actions.append(reply);
    for (const a of msg.attachments || []) {
      const link = document.createElement('a');
      link.href = api.mail.attachmentUrl(uid, a.part, folder);
      link.textContent = `${a.filename} · ${t('mail.compose.attachments')}`;
      const size = document.createElement('wa-format-bytes');
      size.value = a.size;
      link.append(' (', size, ')');
      actions.append(link);
    }
    this._detail.replaceChildren(head, body, actions);
  }
}

customElements.define('mc-mail-detail', McMailDetail);