const $ = (s) => document.querySelector(s);
const SVC_META = {};
const SVC_LABELS = {
  "5-1b": "MiniCPM 5-1B",
  "8b": "MiniCPM 4.1-8B",
  embed: "Embeddings",
  rerank: "Reranker",
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

function svcState(s) {
  if (s.state === "running") return "ok";
  if (s.state === "starting") return "warn";
  return "down";
}

function svcText(s) {
  if (s.state === "running") return "activo";
  if (s.state === "starting") return "arrancando…";
  if (s.state === "error") return "error";
  return "caído";
}

function pollServices() {
  api("/api/services")
    .then((svcs) => {
      const dots = $("#service-dots");
      dots.innerHTML = "";
      for (const [name, s] of Object.entries(svcs)) {
        const d = document.createElement("span");
        d.className = "dot " + svcState(s);
        d.title = `${(SVC_META[name] || {}).label || SVC_LABELS[name] || name} :${s.port} — ${svcText(s)}`;
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

function initMeta() {
  api("/api/meta")
    .then((m) => {
      const svcTab = $('button[data-tab="svc"]');
      if (svcTab) svcTab.textContent = "Servicios";
      for (const [name, info] of Object.entries(m.services)) {
        SVC_META[name] = {
          label: SVC_LABELS[name] || name,
          port: info.port,
          device: info.device,
          model: info.model,
        };
      }
    })
    .catch(() => {});
}

setInterval(pollServices, 5000);
setInterval(pollGpu, 5000);
initMeta();
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

let chatAbort = null;

$("#chat-cancel").addEventListener("click", () => {
  if (chatAbort) chatAbort.abort();
});

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
  let content = "", reason = "";
  chatAbort = new AbortController();
  $("#chat-cancel").classList.remove("hidden");

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
      signal: chatAbort.signal,
    });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).detail || msg; } catch {}
      throw new Error(msg);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let aborted = false;
    while (true) {
      let done, value;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        if (err.name === "AbortError") { aborted = true; break; }
        throw err;
      }
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
    if (aborted) {
      div.querySelector(".bubble").textContent = content || "(cancelado)";
    } else if (!content && !reason) {
      div.querySelector(".bubble").textContent = "(sin respuesta)";
    }
  } catch (err) {
    if (err.name === "AbortError") {
      div.querySelector(".bubble").textContent = content || "(cancelado)";
    } else {
      div.querySelector(".bubble").textContent = "Error: " + err.message;
    }
  } finally {
    chatAbort = null;
    $("#chat-cancel").classList.add("hidden");
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
          `<div class="doc-row"><span>${esc(dd.filename)}</span><span class="muted">${dd.n_chunks} chunks · ${dd.created_at}${dd.status === "indexing" ? " · (indexando…)" : dd.status === "error" ? " · (error)" : ""}</span><button data-del="${dd.id}" class="ghost">Borrar</button></div>`
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
      if (res.state === "indexing") {
        msg.textContent = `Indexando ${f.name}…`;
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        msg.textContent = `OK: ${f.name} → ${res.n_chunks} chunks`;
      }
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
    let content = "", reason = "", sources = [], forced = false, rerank = true;
    const render = () => {
      const forcedMsg = forced ? '<div class="muted">El 5-1b no respondió con el contexto; se usó el 8b automáticamente.</div>' : "";
      const rerankMsg = !rerank && sources.length ? '<div class="muted">Reranker no disponible; orden por similitud coseno.</div>' : "";
      const reasonHtml = reason ? `<details class="reason"><summary>Razonamiento</summary><pre>${esc(reason)}</pre></details>` : "";
      const srcHtml = sources.map((s, i) =>
        `<details class="source"><summary>Fuente ${i + 1}: ${esc(s.filename)} (score ${s.score})</summary><div class="hit-text">${esc(s.text)}</div></details>`
      ).join("");
      rbox.innerHTML = forcedMsg + rerankMsg +
        `<div class="rag-answer"><div class="bubble">${esc(content || "…")}</div></div>` +
        reasonHtml + srcHtml;
    };
    try {
      const resp = await fetch("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          top_k: 4,
          model: $("#chat-model").value,
          no_think: $("#chat-nothink").checked,
          stream: true,
        }),
      });
      if (!resp.ok) {
        let m = resp.statusText;
        try { m = (await resp.json()).detail || m; } catch {}
        throw new Error(m);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let j;
          try { j = JSON.parse(payload); } catch { continue; }
          if (j.type === "sources") {
            sources = j.sources || [];
            render();
          } else if (j.type === "delta") {
            content += j.content || "";
            reason += j.reasoning || "";
            render();
          } else if (j.type === "done") {
            if (j.answer) content = j.answer;
            forced = j.forced_8b;
            rerank = j.rerank;
          } else if (j.type === "error") {
            content = "Error: " + j.detail;
          }
        }
      }
      if (buf.trim()) {
        const line = buf.split("\n").find((l) => l.startsWith("data:"));
        if (line) {
          const payload = line.slice(5).trim();
          if (payload && payload !== "[DONE]") {
            try {
              const j = JSON.parse(payload);
              if (j.type === "done") {
                if (j.answer) content = j.answer;
                forced = j.forced_8b;
                rerank = j.rerank;
              }
            } catch {}
          }
        }
      }
      render();
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
  const m = SVC_META[name] || {};
  const running = s.state === "running";
  const row = document.createElement("tr");
  row.innerHTML = `<td>${m.label || SVC_LABELS[name] || name}</td><td>:${s.port}</td><td><span class="dot ${svcState(s)}"></span> ${svcText(s)}</td>
    <td><button data-act="${name}" data-cmd="start" ${running ? "disabled" : ""}>Iniciar</button>
    <button data-act="${name}" data-cmd="stop" class="ghost" ${running ? "" : "disabled"}>Parar</button></td>`;
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
    if (st.configured && !$("#mail-folder").dataset.loaded) loadMailFolders();
  } catch {}
}

async function loadMailFolders() {
  try {
    const res = await api("/api/mail/folders");
    const sel = $("#mail-folder");
    sel.dataset.loaded = "1";
    sel.innerHTML = res.folders
      .map((f) => `<option value="${esc(f)}">${esc(f)}</option>`)
      .join("");
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

function currentMailFolder() {
  return ($("#mail-folder") && $("#mail-folder").value) || "INBOX";
}

async function loadMailUnread() {
  mailList.dataset.loaded = "1";
  mailList.innerHTML = '<div class="muted">Cargando…</div>';
  try {
    renderMailList(await api("/api/mail/unread?limit=50&folder=" + encodeURIComponent(currentMailFolder())));
  } catch (err) {
    mailList.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
  }
}

$("#mail-folder").addEventListener("change", loadMailUnread);

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
  params.set("folder", currentMailFolder());
  mailList.innerHTML = '<div class="muted">Buscando…</div>';
  try {
    renderMailList(await api("/api/mail/search?" + params));
  } catch (err) {
    mailList.innerHTML = `<div class="muted">Error: ${esc(err.message)}</div>`;
  }
});

$("#mail-inbox").addEventListener("click", loadMailUnread);

let mailReplyCtx = null;

async function openMail(uid) {
  mailDetail.innerHTML = '<div class="muted">Cargando…</div>';
  try {
    const m = await api("/api/mail/fetch?uid=" + uid + "&folder=" + encodeURIComponent(currentMailFolder()));
    const atts = (m.attachments || []).map((a) =>
      `<div class="muted">📎 ${esc(a.filename)} (${esc(a.ctype)}, ${a.size} B) —
        <a href="/api/mail/attachment?uid=${m.uid}&part=${a.part}&folder=${encodeURIComponent(m.folder || currentMailFolder())}">descargar</a></div>`
    ).join("");
    mailDetail.innerHTML =
      `<div class="mail-head"><b>${esc(m.subject || "(sin asunto)")}</b></div>
       <div class="muted">De: ${esc(m.from)} · Para: ${esc(m.to)} · ${esc(m.date)}</div>
       <div class="muted">Msg-ID: ${esc(m.message_id)}</div>
       ${atts}
       <pre class="mail-body">${esc(m.body)}</pre>
       <button id="mail-reply">Responder</button>
       <button data-mark="${m.uid}" data-read="true">Marcar leído</button>
       <button data-mark="${m.uid}" data-read="false" class="ghost">Marcar no leído</button>`;
    $("#mail-reply").addEventListener("click", () => {
      const addr = (m.from.match(/<([^>]+)>/) || [null, m.from])[1];
      $("#mail-to").value = addr;
      const s = m.subject || "";
      $("#mail-subject-new").value = /^re:/i.test(s) ? s : "Re: " + s;
      mailReplyCtx = { in_reply_to: m.message_id, references: m.references || "" };
      document.querySelector(".mail-compose").scrollIntoView({ behavior: "smooth" });
    });
    mailDetail.querySelectorAll("[data-mark]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api("/api/mail/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: +b.dataset.mark, read: b.dataset.read === "true", folder: currentMailFolder() }),
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
    const payload = {
      to: $("#mail-to").value.trim(),
      subject: $("#mail-subject-new").value.trim(),
      body: $("#mail-body").value,
    };
    if (mailReplyCtx) {
      payload.in_reply_to = mailReplyCtx.in_reply_to;
      payload.references = mailReplyCtx.references;
    }
    const res = await api("/api/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    mailReplyCtx = null;
    alert("Enviado a " + res.to);
    e.target.reset();
  } catch (err) {
    alert("Error al enviar: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Enviar";
});

refreshDocs();