/**
 * @module mc-services
 * @summary Panel de servicios (I8): slot GPU, resumen (GPU/host/contexto),
 *   lista con arranque/parada y registros con autoscroll.
 * @attr (sin atributos públicos; API = métodos)
 * @part head cabecera (título + slot) · @part cards resumen · @part list filas ·
 *   @part logs registros (selector + wa-scroller)
 * @method focusRow(name) selecciona en logs, marca la fila y hace scroll
 * @method setActive(on) pausa/reanuda polling de logs según pestaña activa
 * @method refresh() recarga slot, resumen y lista
 *
 * Polling: /api/services y /api/gpu cada 5s; /api/logs/{name} cada 3s solo para
 *   el servicio seleccionado y con la pestaña activa. Autoscroll solo si el
 *   usuario está en el fondo (margen 24px).
 */
import { t } from '../i18n.js';
import { api } from '../api.js';

const AUTO_SCROLL_MARGIN = 24;
const LIST_POLL = 5000;
const LOG_POLL = 3000;
const START_TIMEOUT = { '8b': 190000, default: 70000 };

const styles = new CSSStyleSheet();
styles.replaceSync(`
:host{display:flex;flex-direction:column;flex:1;min-height:0;font-family:var(--mc-sans);color:var(--mc-text)}
.wrap{display:flex;flex-direction:column;gap:var(--mc-space-gap);padding:var(--mc-space-gap) var(--mc-space-page);flex:1;min-height:0}
.head{display:flex;align-items:center;gap:var(--mc-space-gap)}.title{font-weight:var(--wa-font-weight-semibold);margin-inline-end:auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:var(--mc-space-gap)}
.card{display:flex;flex-direction:column;gap:calc(var(--mc-space-gap)*0.5);padding:var(--mc-space-gap);border:var(--wa-border-width-s) solid var(--mc-surface-border);border-radius:var(--mc-radius-s);background:var(--mc-surface-raised);font-size:var(--wa-font-size-s)}
.card-label{color:var(--mc-text-quiet);font-size:var(--wa-font-size-xs);text-transform:uppercase;letter-spacing:.04em}
.card .mono{font-family:var(--mc-mono);font-variant-numeric:tabular-nums}
.list{display:flex;flex-direction:column;gap:var(--mc-space-gap)}.empty{color:var(--mc-text-quiet);margin:0}
.logs{display:flex;flex-direction:column;gap:var(--mc-space-gap);flex:1;min-height:0}.log-bar{display:flex;align-items:center;gap:var(--mc-space-gap)}
.log-title{color:var(--mc-text-quiet);font-weight:var(--wa-font-weight-semibold)}.log-select{min-width:12rem}
wa-scroller{flex:1;min-height:0;border:var(--wa-border-width-s) solid var(--mc-surface-border);border-radius:var(--mc-radius-s);background:var(--mc-surface-raised)}
pre{margin:0;padding:var(--mc-space-gap);font-family:var(--mc-mono);font-size:var(--wa-font-size-xs);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--mc-text)}
`);

export class McServices extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._services = {};
    this._metaServices = {};
    this._selected = null;
    this._active = true;
    this._listTimer = null;
    this._logTimer = null;
    this._rows = new Map();
    this._atBottom = true;
  }

  connectedCallback() {
    if (!this._wired) {
      this._render();
      this._wire();
      this._wired = true;
    }
    this._listTimer = setInterval(() => this._refreshServices(), LIST_POLL);
    this.refresh();
  }
  disconnectedCallback() {
    if (this._listTimer) clearInterval(this._listTimer);
    this._listTimer = null;
    this._stopLog();
  }
  setActive(on) {
    this._active = on;
    if (on) this._startLog();
    else this._stopLog();
  }
  async refresh() {
    await Promise.all([this._refreshSlot(), this._refreshCards(), this._refreshServices()]);
  }
  focusRow(name) {
    if (!this._services[name]) return;
    this._selected = name;
    this._renderRows();
    this._logSelect.value = name;
    this._startLog();
    const row = this._rows.get(name);
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus?.();
  }
  _render() {
    this.shadowRoot.innerHTML = `<div class="wrap" part="wrap"><div class="head" part="head"><span class="title">${t('services.title')}</span><wa-tooltip class="slot-tip" content="${t('services.slotDisabled')}"><wa-select class="slot" part="slot" label="${t('services.slot')}" size="small"><wa-option value="none">${t('services.slotNone')}</wa-option><wa-option value="8b">8b</wa-option><wa-option value="v45" disabled>v45</wa-option><wa-option value="mcp" disabled>mcp</wa-option></wa-select></wa-tooltip></div><div class="cards" part="cards"><div class="card gpu"><span class="card-label">${t('gpu.label')}</span><wa-progress-bar class="gpu-bar" value="0"></wa-progress-bar><span class="gpu-body mono"></span></div><div class="card host"><span class="card-label">${t('services.load')}</span><span class="host-body mono"></span></div><div class="card ctx"><span class="card-label">${t('services.contextWindow')}</span><span class="ctx-body mono"></span></div></div><div class="list" part="list"></div><div class="logs" part="logs"><div class="log-bar"><span class="log-title">${t('services.logs')}</span><wa-select class="log-select" size="small"></wa-select></div><wa-scroller class="scroller" orientation="vertical"><pre class="pre" part="pre"></pre></wa-scroller></div></div>`;
    this._slot = this.shadowRoot.querySelector('.slot');
    this._gpuBar = this.shadowRoot.querySelector('.gpu-bar');
    this._gpuBody = this.shadowRoot.querySelector('.gpu-body');
    this._hostBody = this.shadowRoot.querySelector('.host-body');
    this._ctxBody = this.shadowRoot.querySelector('.ctx-body');
    this._list = this.shadowRoot.querySelector('.list');
    this._logSelect = this.shadowRoot.querySelector('.log-select');
    this._scroller = this.shadowRoot.querySelector('.scroller');
    this._pre = this.shadowRoot.querySelector('.pre');
  }
  _wire() {
    this._slot.addEventListener('change', () => this._setSlot());
    this._logSelect.addEventListener('change', () => {
      this._selected = this._logSelect.value || null;
      this._renderRows();
      this._startLog();
    });
    this._list.addEventListener('mc-control-service', (e) => {
      const { name, action } = e.detail || {};
      if (action === 'start') this._start(name);
      else if (action === 'stop') this._stop(name);
    });
    this._scroller.addEventListener('scroll', () => {
      const c = this._scroller.content;
      this._atBottom = c.scrollHeight - c.scrollTop - c.clientHeight <= AUTO_SCROLL_MARGIN;
    });
  }
  async _refreshSlot() {
    try {
      const slot = await api.getSlot();
      this._slot.value = slot?.occupant || 'none';
    } catch { /* silencioso */ }
  }
  async _setSlot() {
    try {
      await api.setSlot({ occupant: this._slot.value });
      this.refresh();
    } catch (err) {
      window.mcToast?.show(err.message || t('status.error'), { variant: 'danger' });
      this._refreshSlot();
    }
  }
  async _refreshCards() {
    const [gpu, host, meta] = await Promise.all([
      api.services.gpu().catch(() => null),
      api.services.host().catch(() => null),
      api.services.meta().catch(() => null),
    ]);
    this._metaServices = meta?.services || {};
    if (gpu) {
      const pct = gpu.util_pct ?? 0;
      this._gpuBody.textContent = `${gpu.used_mib ?? '?'} / ${gpu.total_mib ?? '?'} MiB · ${pct}%`;
      this._gpuBar.value = Math.max(0, Math.min(100, pct));
    } else {
      this._gpuBody.textContent = t('gpu.unavailable');
      this._gpuBar.value = 0;
    }
    const load = host?.load_avg?.[0];
    this._hostBody.textContent = load != null ? `${load.toFixed(2)}` + (host.uptime_h != null ? ` · ${t('services.uptime')} ${host.uptime_h}h` : '') : '—';
    const s = meta?.sampling;
    this._ctxBody.textContent = meta?.ctx != null ? `ctx ${meta.ctx}` + (s ? ` · T ${s.temp} · p ${s.top_p}` : '') : '—';
  }
  async _refreshServices() {
    try {
      this._services = (await api.services.list()) || {};
    } catch {
      this._services = {};
    }
    this._renderRows();
    if (this._selected && !this._services[this._selected]) {
      this._selected = null;
      this._logSelect.value = '';
      this._pre.textContent = t('services.logEmpty');
    } else if (this._selected) this._startLog();
  }
  _renderRows() {
    this._list.replaceChildren();
    this._rows.clear();
    const names = Object.keys(this._services);
    if (!names.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = t('services.noServices');
      this._list.append(p);
      return;
    }
    this._logSelect.replaceChildren();
    for (const name of names) {
      const opt = document.createElement('wa-option');
      opt.value = name;
      opt.textContent = name;
      this._logSelect.append(opt);
      const svc = this._services[name] || {};
      const meta = this._metaServices[name] || {};
      const row = document.createElement('mc-service-row');
      row.setAttribute('name', name);
      row.setAttribute('state', svc.state || 'stopped');
      row.setAttribute('device', meta.device || '');
      row.setAttribute('model', meta.model || name);
      if (svc.uptime_s != null) row.setAttribute('uptime_s', String(svc.uptime_s));
      if (svc.tokens_per_s != null) row.setAttribute('tokens_per_s', String(svc.tokens_per_s));
      if (this._selected === name) row.setAttribute('selected', '');
      this._list.append(row);
      this._rows.set(name, row);
    }
    if (this._selected && names.includes(this._selected)) this._logSelect.value = this._selected;
    else if (names.length) this._logSelect.value = names[0];
  }
  async _start(name) {
    const timeout = START_TIMEOUT[name] || START_TIMEOUT.default;
    this._setRowState(name, 'starting');
    try {
      await api.services.start(name, timeout);
      this._refreshServices();
    } catch (err) {
      window.mcToast?.show(err.message || t('status.error'), { variant: 'danger' });
      this._refreshServices();
    }
  }
  async _stop(name) {
    const ok = await window.mcConfirm?.open({
      label: t('services.confirmStopTitle'),
      body: t('services.confirmStopBody'),
      confirmLabel: t('services.stop'),
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.services.stop(name);
      this._refreshServices();
    } catch (err) {
      window.mcToast?.show(err.message || t('status.error'), { variant: 'danger' });
      this._refreshServices();
    }
  }
  _setRowState(name, state) { this._rows.get(name)?.setAttribute('state', state); }
  _startLog() {
    this._stopLog();
    if (!this._active || !this._selected) return;
    this._pollLog();
    this._logTimer = setInterval(() => this._pollLog(), LOG_POLL);
  }
  _stopLog() {
    if (this._logTimer) { clearInterval(this._logTimer); this._logTimer = null; }
  }
  async _pollLog() {
    if (!this._selected) return;
    try {
      const data = await api.services.logs(this._selected);
      const lines = (data && data.lines) || [];
      this._pre.textContent = lines.length ? lines.join('\n') : t('services.logEmpty');
      if (this._atBottom) this._scroller.content.scrollTop = this._scroller.content.scrollHeight;
    } catch { /* silencioso */ }
  }
}

customElements.define('mc-services', McServices);
