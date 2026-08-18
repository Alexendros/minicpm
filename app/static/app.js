const $ = (s) => document.querySelector(s);
const SVC_META = {
  "5-1b": { label: "MiniCPM 5-1B", port: 8080 },
  "8b": { label: "MiniCPM 4.1-8B", port: 8081 },
  embed: { label: "Embeddings", port: 8002 },
  rerank: { label: "Reranker", port: 8003 },
};

document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("#tab-" + b.dataset.tab).classList.add("active");
  });
});

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

function pollServices() {
  api("/api/services")
    .then((svcs) => {
      const dots = $("#service-dots");
      dots.innerHTML = "";
      for (const [name, s] of Object.entries(svcs)) {
        const d = document.createElement("span");
        d.className = "dot " + (s.running ? "ok" : "down");
        d.title = `${SVC_META[name].label} :${s.port} — ${s.running ? "activo" : "caído"}`;
        dots.appendChild(d);
      }
    })
    .catch(() => {});
}

function pollGpu() {
  api("/api/gpu")
    .then((g) => {
      if (!g) { $("#gpu-info").textContent = "GPU no disponible"; return; }
      const pct = Math.round((g.used_mib / g.total_mib) * 100);
      $("#gpu-info").innerHTML =
        `${esc(g.name || "GPU")} — <b>${g.used_mib} / ${g.total_mib} MiB</b> (${pct}%) · GPU ${g.util_pct}%`;
    })
    .catch(() => {});
}

setInterval(pollServices, 5000);
setInterval(pollGpu, 5000);
pollServices();
pollGpu();

const chatLog = $("#chat-log");

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function parseSseChunk(buf) {
  const lines = buf.split("\n").filter((l) => l.startsWith("data:"));
  let content = "", reason = "";
  for (const l of lines) {
    const payload = l.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload);
      const d = j.choices?.[0]?.delta || {};
      content += d.content || "";
      reason += d.reasoning_content || "";
    } catch {}
  }
  return { content, reason };
}

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMsg("user", text);

  const model = $("#chat-model").value;
  const div = addMsg("assistant", "…");
  let reasonEl = null;

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: text }],
        no_think: $("#chat-nothink").checked,
        session_id: currentSession,
      }),
    });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).detail || msg; } catch {}
      throw new Error(msg);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", reason = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const ch = parseSseChunk(part);
        content += ch.content;
        reason += ch.reason;
        if (reason && !reasonEl && model === "8b") {
          reasonEl = document.createElement("details");
          reasonEl.className = "reason";
          reasonEl.innerHTML = "<summary>Razonamiento</summary><pre></pre>";
          div.querySelector(".bubble").after(reasonEl);
        }
        if (reasonEl) reasonEl.querySelector("pre").textContent = reason;
        div.querySelector(".bubble").textContent = content || "…";
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }
    if (buf.trim()) {
      const ch = parseSseChunk(buf);
      content += ch.content;
      reason += ch.reason;
      if (reason && !reasonEl && model === "8b") {
        reasonEl = document.createElement("details");
        reasonEl.className = "reason";
        reasonEl.innerHTML = "<summary>Razonamiento</summary><pre></pre>";
        div.querySelector(".bubble").after(reasonEl);
      }
      if (reasonEl) reasonEl.querySelector("pre").textContent = reason;
      div.querySelector(".bubble").textContent = content || "…";
      chatLog.scrollTop = chatLog.scrollHeight;
    }
    if (!content && !reason) div.querySelector(".bubble").textContent = "(sin respuesta)";
  } catch (err) {
    div.querySelector(".bubble").textContent = "Error: " + err.message;
  }
  refreshSessions();
});

$("#chat-clear").addEventListener("click", () => { chatLog.innerHTML = ""; });

let currentSession = null;

async function refreshSessions() {
  let sessions = [];
  try { sessions = await api("/api/sessions"); } catch { return; }
  $("#chat-session").innerHTML =
    '<option value="">— Sin sesión —</option>' +
    sessions.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.n_messages})</option>`).join("");
  $("#chat-session").value = currentSession ?? "";
  $("#chat-del-session").disabled = !currentSession;
}

$("#chat-session").addEventListener("change", async (e) => {
  currentSession = e.target.value ? Number(e.target.value) : null;
  $("#chat-del-session").disabled = !currentSession;
  chatLog.innerHTML = "";
  if (!currentSession) return;
  try {
    const s = await api("/api/sessions/" + currentSession);
    for (const m of s.messages) addMsg(m.role, m.content);
  } catch {}
});

$("#chat-new-session").addEventListener("click", async () => {
  const { id } = await api("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  currentSession = id;
  chatLog.innerHTML = "";
  await refreshSessions();
});

$("#chat-del-session").addEventListener("click", async () => {
  if (!currentSession) return;
  await api("/api/sessions/" + currentSession, { method: "DELETE" });
  currentSession = null;
  chatLog.innerHTML = "";
  await refreshSessions();
});

async function refreshDocs() {
  try {
    const d = await api("/api/documents");
    const docs = d.documents;
    const warn = d.n_chunks > 3000
      ? `<div class="muted">Base con ${d.n_chunks} chunks: la búsqueda puede ser lenta</div>`
      : "";
    $("#kb-list").innerHTML = warn + (docs.length
      ? docs.map((dd) =>
          `<div class="doc-row"><span>${esc(dd.filename)}</span><span class="muted">${dd.n_chunks} chunks · ${dd.created_at}</span><button data-del="${dd.id}" class="ghost">Borrar</button></div>`
        ).join("")
      : '<div class="muted">Sin documentos</div>');
    $("#kb-list").querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api("/api/documents/" + b.dataset.del, { method: "DELETE" });
refreshDocs();
refreshSessions();
      })
    );
  } catch {}
}

$("#kb-file").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  const msg = $("#kb-upload-msg");
  for (const f of files) {
    msg.textContent = `Procesando ${f.name}…`;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await api("/api/documents", { method: "POST", body: fd });
      msg.textContent = `OK: ${f.name} → ${res.n_chunks} chunks`;
    } catch (err) {
      msg.textContent = `Error en ${f.name}: ${err.message}`;
    }
  }
refreshDocs();
refreshSessions();
});

$("#kb-search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#kb-query").value.trim();
  if (!q) return;
  const rag = e.submitter?.dataset.rag;
  const box = $("#kb-results");
  const rbox = $("#rag-result");
  box.innerHTML = "";
  rbox.innerHTML = "";
  if (rag) {
    rbox.innerHTML = '<div class="muted">Pensando…</div>';
    try {
      const res = await api("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          top_k: 4,
          model: $("#chat-model").value,
          no_think: $("#chat-nothink").checked,
        }),
      });
      rbox.innerHTML =
        (res.forced_8b ? '<div class="muted">El 5-1b no respondió con el contexto; se usó el 8b automáticamente.</div>' : "") +
        `<div class="rag-answer"><div class="bubble">${esc(res.answer)}</div></div>` +
        (res.reasoning ? `<details class="reason"><summary>Razonamiento</summary><pre>${esc(res.reasoning)}</pre></details>` : "") +
        res.sources.map((s, i) =>
          `<details class="source"><summary>Fuente ${i + 1}: ${esc(s.filename)} (score ${s.score})</summary><div class="hit-text">${esc(s.text)}</div></details>`
        ).join("");
    } catch (err) {
      rbox.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
    }
    return;
  }
  box.innerHTML = '<div class="muted">Buscando…</div>';
  try {
    const res = await api(`/api/search?query=${encodeURIComponent(q)}&top_k=5&rerank=${$("#kb-rerank").checked}`);
    box.innerHTML = res.length
      ? res.map((r) =>
          `<div class="hit"><div class="hit-head">${esc(r.filename)} #${r.chunk_idx} — <span class="muted">cos ${r.cosine}${r.rerank_score != null ? " · rerank " + r.rerank_score : ""}</span></div><div class="hit-text">${esc(r.text)}</div></div>`
        ).join("")
      : '<div class="muted">Sin resultados</div>';
  } catch (err) {
    box.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
  }
});

function renderSvc(name, s) {
  const m = SVC_META[name];
  const row = document.createElement("tr");
  row.innerHTML = `<td>${m.label}</td><td>:${m.port}</td><td><span class="dot ${s.running ? "ok" : "down"}"></span> ${s.running ? "activo" : "caído"}</td>
    <td><button data-act="${name}" data-cmd="start" ${s.running ? "disabled" : ""}>Iniciar</button>
    <button data-act="${name}" data-cmd="stop" class="ghost" ${s.running ? "" : "disabled"}>Parar</button></td>`;
  return row;
}

function refreshSvc() {
  api("/api/services")
    .then((svcs) => {
      const tbody = $("#svc-rows");
      tbody.innerHTML = "";
      for (const [name, s] of Object.entries(svcs)) tbody.appendChild(renderSvc(name, s));
      tbody.querySelectorAll("[data-act]").forEach((b) =>
        b.addEventListener("click", async () => {
          await api(`/api/services/${b.dataset.act}/${b.dataset.cmd}`, { method: "POST" });
          setTimeout(refreshSvc, 1500);
          refreshLogs(b.dataset.act);
        })
      );
    })
    .catch(() => {});
}

async function refreshLogs(name) {
  try {
    const { lines } = await api("/api/logs/" + name);
    if (!document.querySelector(".tabs button[data-tab=svc]").classList.contains("active")) return;
    $("#svc-logs").innerHTML = lines.map((l) => `<div class="log-line">${esc(l)}</div>`).join("");
  } catch {}
}

document.querySelector('button[data-tab="svc"]').addEventListener("click", () => {
  refreshSvc();
  for (const n of Object.keys(SVC_META)) refreshLogs(n);
});

document.querySelector('button[data-tab="mail"]').addEventListener("click", () => {
  refreshMailStatus();
});

setInterval(() => {
  if (!document.querySelector(".tabs button[data-tab=mail]").classList.contains("active")) return;
  refreshMailStatus();
}, 60000);

const mailList = $("#mail-list");
const mailDetail = $("#mail-detail");

async function refreshMailStatus() {
  try {
    const st = await api("/api/mail/status");
    $("#mail-bridge").textContent = "Bridge: " + (st.bridge_up ? "activo" : "caído");
    $("#mail-bridge").className = "badge " + (st.bridge_up ? "ok" : "down");
    $("#mail-creds").textContent = "Credenciales: " + (st.configured ? st.user : "no configuradas");
    $("#mail-creds").className = "badge " + (st.configured ? "ok" : "down");
    $("#mail-config-form").classList.toggle("hidden", st.configured);
    if (st.configured && !mailList.dataset.loaded) loadMailUnread();
  } catch {}
}

$("#mail-config-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Probando…";
  try {
    await api("/api/mail/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: $("#mail-user").value.trim(), password: $("#mail-pass").value }),
    });
    $("#mail-pass").value = "";
    await refreshMailStatus();
    loadMailUnread();
  } catch (err) {
    alert("Configuración rechazada: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Guardar y probar";
});

function renderMailList(res) {
  mailList.innerHTML =
    `<div class="muted">${res.count} mensaje(s)</div>` +
    res.messages.map((m) =>
      `<div class="mail-item" data-uid="${m.uid}">
        <div class="mail-head">${esc(m.from)} — <span class="muted">${esc(m.date)}</span></div>
        <div class="mail-subject">${esc(m.subject || "(sin asunto)")}</div>
      </div>`
    ).join("") || '<div class="muted">Sin resultados</div>';
  mailList.querySelectorAll("[data-uid]").forEach((el) =>
    el.addEventListener("click", () => openMail(el.dataset.uid))
  );
}

async function loadMailUnread() {
  mailList.dataset.loaded = "1";
  mailList.innerHTML = '<div class="muted">Cargando…</div>';
  try {
    renderMailList(await api("/api/mail/unread?limit=50"));
  } catch (err) {
    mailList.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
  }
}

$("#mail-search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = new URLSearchParams({ limit: "50" });
  const from = $("#mail-from").value.trim();
  const subject = $("#mail-subject").value.trim();
  const text = $("#mail-text").value.trim();
  const since = $("#mail-since").value;
  if (from) params.set("from_", from);
  if (subject) params.set("subject", subject);
  if (text) params.set("text", text);
  if (since) params.set("since", since);
  if ($("#mail-unread").checked) params.set("unread", "true");
  mailList.innerHTML = '<div class="muted">Buscando…</div>';
  try {
    renderMailList(await api("/api/mail/search?" + params));
  } catch (err) {
    mailList.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
  }
});

$("#mail-inbox").addEventListener("click", loadMailUnread);

async function openMail(uid) {
  mailDetail.innerHTML = '<div class="muted">Cargando…</div>';
  try {
    const m = await api("/api/mail/fetch?uid=" + uid);
    mailDetail.innerHTML =
      `<div class="mail-head"><b>${esc(m.subject || "(sin asunto)")}</b></div>
       <div class="muted">De: ${esc(m.from)} · Para: ${esc(m.to)} · ${esc(m.date)}</div>
       <div class="muted">Msg-ID: ${esc(m.message_id)}</div>
       <pre class="mail-body">${esc(m.body)}</pre>
       <button id="mail-reply">Responder</button>
       <button data-mark="${m.uid}" data-read="true">Marcar leído</button>
       <button data-mark="${m.uid}" data-read="false" class="ghost">Marcar no leído</button>`;
    $("#mail-reply").addEventListener("click", () => {
      const addr = (m.from.match(/<([^>]+)>/) || [null, m.from])[1];
      $("#mail-to").value = addr;
      const s = m.subject || "";
      $("#mail-subject-new").value = /^re:/i.test(s) ? s : "Re: " + s;
      document.querySelector(".mail-compose").scrollIntoView({ behavior: "smooth" });
    });
    mailDetail.querySelectorAll("[data-mark]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api("/api/mail/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: +b.dataset.mark, read: b.dataset.read === "true" }),
        });
        loadMailUnread();
      })
    );
  } catch (err) {
    mailDetail.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
  }
}

$("#mail-compose-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  try {
    const res = await api("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: $("#mail-to").value.trim(),
        subject: $("#mail-subject-new").value.trim(),
        body: $("#mail-body").value,
      }),
    });
    alert("Enviado a " + res.to);
    e.target.reset();
  } catch (err) {
    alert("Error al enviar: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Enviar";
});

refreshDocs();