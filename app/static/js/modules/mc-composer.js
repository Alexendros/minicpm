/**
 * @module mc-composer
 * @summary Composer del chat: textarea, envío, detener y callout de modelo parado.
 * @attr {Boolean} streaming — Modo generación: desactiva Enviar y muestra Detener.
 * @part composer Contenedor del área de entrada.
 * @part textarea Área de texto.
 * @part actions Botones de acción.
 * @part callout Aviso de modelo no disponible.
 * @fires mc-send — al enviar, con {text}.
 * @fires mc-abort — al pulsar Detener o Escape con foco.
 * @fires mc-go-services — al pulsar «Ir a Servicios» del callout.
 */
import { t } from '../i18n.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--mc-space-gap);
    border-top: var(--wa-border-width-s) solid var(--mc-surface-border);
    padding: var(--mc-space-gap) var(--mc-space-page);
    min-height: var(--mc-composer-min-h);
  }
  .callout { margin: 0; }
  .callout[hidden] { display: none; }
  .callout::part(message) {
    display: flex;
    align-items: center;
    gap: var(--mc-space-gap);
  }
  .callout-msg { flex: 1; }
  .actions {
    display: flex;
    align-items: flex-end;
    gap: var(--mc-space-gap);
  }
  .actions wa-textarea { flex: 1; }
`);

export class McComposer extends HTMLElement {
  static observedAttributes = ['streaming'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._streaming = false;
  }

  connectedCallback() {
    if (!this._wired) {
      this._render();
      this._wire();
      this._wired = true;
    }
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'streaming') this.setStreaming(value != null);
  }

  get value() {
    return this._input?.value ?? '';
  }

  setCallout(show, msg) {
    this._callout.hidden = !show;
    if (msg) this._calloutMsg.textContent = msg;
  }

  setStreaming(on) {
    this._streaming = on;
    this._send.disabled = on;
    this._stop.hidden = !on;
  }

  clear() {
    this._input.value = '';
    this._input.focus();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <wa-callout class="callout" part="callout" variant="warning" hidden>
        <span class="callout-msg"></span>
        <wa-button class="go-svc" size="small">${t('session.goServices')}</wa-button>
      </wa-callout>
      <div class="actions" part="actions">
        <wa-textarea class="input" part="textarea" rows="1" resize="auto" placeholder="${t('session.chat.placeholder')}"></wa-textarea>
        <wa-button class="send" part="send" variant="brand">
          <wa-icon name="paper-plane"></wa-icon>
          ${t('session.chat.send')}
        </wa-button>
        <wa-button class="stop" part="stop" variant="neutral" hidden>
          <wa-icon name="stop"></wa-icon>
          ${t('session.chat.stop')}
        </wa-button>
      </div>
    `;
    this._callout = this.shadowRoot.querySelector('.callout');
    this._calloutMsg = this.shadowRoot.querySelector('.callout-msg');
    this._input = this.shadowRoot.querySelector('.input');
    this._send = this.shadowRoot.querySelector('.send');
    this._stop = this.shadowRoot.querySelector('.stop');
  }

  _wire() {
    this._send.addEventListener('click', () => this._emitSend());
    this._stop.addEventListener('click', () => this._emitAbort());
    this._goSvc = this.shadowRoot.querySelector('.go-svc');
    this._goSvc.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('mc-go-services', { bubbles: true, composed: true })));
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._emitSend();
      } else if (e.key === 'Escape' && this._streaming) {
        this._emitAbort();
      }
    });
  }

  _emitSend() {
    const text = this._input.value.trim();
    if (!text) return;
    this.dispatchEvent(new CustomEvent('mc-send', {
      detail: { text },
      bubbles: true,
      composed: true,
    }));
  }

  _emitAbort() {
    this.dispatchEvent(new CustomEvent('mc-abort', { bubbles: true, composed: true }));
  }
}

customElements.define('mc-composer', McComposer);