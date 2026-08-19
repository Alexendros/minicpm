/**
 * @module mc-chat-log
 * @summary Registro de burbujas de conversación con renderizado Markdown (I1–I4).
 * @part log Contenedor de burbujas.
 */
import { t } from '../i18n.js';
import { render } from '../markdown.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    display: block;
    flex: 1;
    min-height: 0;
  }
  .log {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--mc-space-gap);
    padding: var(--mc-space-gap) var(--mc-space-page);
  }
  .bubble {
    max-width: min(78%, 46rem);
    padding: var(--mc-space-gap) var(--mc-space-page);
    border-radius: var(--mc-radius);
    font-size: 0.95rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--mc-bubble-user);
    color: var(--mc-bubble-user-text);
  }
  .bubble.assistant {
    align-self: flex-start;
    background: var(--mc-bubble-assistant);
    color: var(--mc-bubble-assistant-text);
  }
  .skeleton {
    align-self: stretch;
    border-radius: var(--mc-radius);
  }
  .reasoning { margin-bottom: var(--mc-space-gap); }
  .reasoning-body {
    white-space: pre-wrap;
    font-family: var(--mc-mono);
    font-size: 0.875rem;
    color: var(--mc-text-quiet);
  }
`);

class Bubble {
  constructor(host, role, busy) {
    this.el = document.createElement('article');
    this.el.setAttribute('class', `bubble ${role}`);
    this.el.setAttribute('part', 'bubble');
    if (role === 'assistant') {
      this.el.setAttribute('aria-busy', busy ? 'true' : 'false');
      this.el.innerHTML = '<div class="content"><div class="answer"></div></div>';
      this.answer = this.el.querySelector('.answer');
    }
    host.append(this.el);
  }

  setText(text) {
    if (this.answer) this.answer.textContent = text;
    else this.el.textContent = text;
  }

  setMarkdown(text) {
    this.answer.replaceChildren();
    this.answer.append(render(text));
  }

  addReasoning(text) {
    let details = this.el.querySelector('.reasoning');
    if (!details) {
      details = document.createElement('wa-details');
      details.setAttribute('class', 'reasoning');
      details.summary = t('session.chat.thinking');
      const body = document.createElement('div');
      body.setAttribute('class', 'reasoning-body');
      details.append(body);
      this.el.querySelector('.content').prepend(details);
      details._body = body;
    }
    details._body.textContent += text;
  }

  setBusy(on) {
    this.el.setAttribute('aria-busy', on ? 'true' : 'false');
  }
}

export class McChatLog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.shadowRoot.innerHTML = `<div class="log" part="log" role="log" aria-live="polite"></div>`;
    this._log = this.shadowRoot.querySelector('.log');
  }

  clear() {
    this._log.replaceChildren();
  }

  skeletons() {
    for (let i = 0; i < 2; i++) {
      const s = document.createElement('wa-skeleton');
      s.setAttribute('class', 'skeleton');
      this._log.append(s);
    }
  }

  addUser(text) {
    const bubble = new Bubble(this._log, 'user');
    bubble.setText(text);
    this.scrollEnd();
    return bubble;
  }

  addAssistant(busy) {
    const bubble = new Bubble(this._log, 'assistant', busy);
    this.scrollEnd();
    return bubble;
  }

  scrollEnd() {
    this._log.scrollTop = this._log.scrollHeight;
  }
}

customElements.define('mc-chat-log', McChatLog);