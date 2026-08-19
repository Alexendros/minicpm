/**
 * @module mc-mail-compose
 * @summary Diálogo de redacción: campos, envío y descarte de borrador (I12).
 * @part compose Formulario del diálogo.
 * @fires mc-sent — al enviar con éxito, con {to}.
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  .compose-form { display: flex; flex-direction: column; gap: var(--mc-space-gap); }
  .compose-form wa-textarea { min-height: 8rem; }
`);

export class McMailCompose extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._dirty = false;
    this._reply = null;
    this._allowClose = false;
  }

  connectedCallback() {
    if (!this._wired) {
      this._render();
      this._wire();
      this._wired = true;
    }
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <wa-dialog class="compose-dialog" label="${t('mail.compose.title')}">
        <div class="compose-form" part="compose">
          <wa-input class="c-to" label="${t('mail.compose.to')}"></wa-input>
          <wa-input class="c-subject" label="${t('mail.compose.subject')}"></wa-input>
          <wa-textarea class="c-body" label="${t('mail.compose.body')}"></wa-textarea>
        </div>
        <wa-button class="c-send" slot="footer" variant="brand">${t('mail.compose.send')}</wa-button>
      </wa-dialog>
    `;
    this._dialog = this.shadowRoot.querySelector('.compose-dialog');
    this._cTo = this.shadowRoot.querySelector('.c-to');
    this._cSubject = this.shadowRoot.querySelector('.c-subject');
    this._cBody = this.shadowRoot.querySelector('.c-body');
    this._sendBtn = this.shadowRoot.querySelector('.c-send');
  }

  _wire() {
    this._dialog.addEventListener('wa-request-close', (e) => {
      if (this._dirty && !this._allowClose) {
        e.preventDefault();
        this._confirmDiscard();
      }
    });
    this._dialog.addEventListener('wa-after-hide', () => { this._dirty = false; this._allowClose = false; });
    for (const el of [this._cTo, this._cSubject, this._cBody]) {
      el.addEventListener('input', () => { this._dirty = true; });
    }
    this._sendBtn.addEventListener('click', () => this._send());
  }

  open(reply = null) {
    this._dirty = false;
    this._reply = reply;
    this._cTo.value = reply?.to || '';
    this._cSubject.value = reply?.subject || '';
    this._cBody.value = '';
    this._dialog.open = true;
  }

  async _send() {
    const to = this._cTo.value.trim();
    const subject = this._cSubject.value.trim();
    const body = this._cBody.value;
    if (!subject) {
      window.mcToast?.show(t('mail.emptySubject'), { variant: 'warning' });
      return;
    }
    this._sendBtn.loading = true;
    try {
      await api.mail.send({ to, subject, body, ...(this._reply || {}) });
      window.mcToast?.show(t('mail.compose.sent', { to }));
      this.dispatchEvent(new CustomEvent('mc-sent', { detail: { to }, bubbles: true, composed: true }));
      this._allowClose = true;
      this._dialog.open = false;
    } catch (err) {
      window.mcToast?.show(err.message ?? t('mail.connectorDown'), { variant: 'danger' });
    } finally {
      this._sendBtn.loading = false;
    }
  }

  async _confirmDiscard() {
    const ok = await window.mcConfirm?.open({
      label: t('mail.compose.discardTitle'),
      body: t('mail.compose.discardBody'),
      confirmVariant: 'danger',
    });
    if (ok) {
      this._allowClose = true;
      this._dialog.open = false;
    }
  }
}

customElements.define('mc-mail-compose', McMailCompose);