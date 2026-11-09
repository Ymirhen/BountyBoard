/* Carpathia Bounty Board: static client for GitHub Pages.
 *
 * Public: reads the "Active" tab of the Bounty Records sheet and shows wanted-poster cards.
 * GMs (signed in with Google):
 *   - write one-shot modules in the builder. Each module is a JSON file in the GM's own Drive
 *     (the source of truth, private to them), plus a generated Google Doc run sheet;
 *   - publish and update the public card (a row in the Active tab);
 *   - close a bounty out, which archives it to Completed/Failed and logs every merc.
 * Who counts as a GM is enforced by Google: only editors of the sheet can write to it. */
(function () {
  "use strict";

  const CFG = window.BOARD_CONFIG || {};
  const TABS = CFG.TABS || { active: "Active", completed: "Completed", failed: "Failed", players: "Completed by players" };
  const C = window.CARPATHIA;
  const ACTIVE_COLS = ["id", "title", "level", "reward_gold", "status", "gm_name", "session_time", "party_size",
    "location", "hook", "image_url", "created_at", "updated_at"];
  const STATUSES = ["All", "Open", "Full"];
  const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",   // the GM's own module files and run sheets (only files this app created)
    "https://www.googleapis.com/auth/spreadsheets", // publish cards and archive results in the Bounty Records sheet
    "openid", "email", "profile",
  ].join(" ");
  const DEMO = new URLSearchParams(location.search).has("demo");

  const state = {
    bounties: [], filter: "All", sort: "newest",
    token: null, user: null, tokenClient: null,
    current: null, // { fileId, module }
  };
  const $ = (id) => document.getElementById(id);

  // ---------- small helpers ----------
  const safeUrl = (v) => { try { const u = new URL(String(v || "").trim()); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };
  const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nowIso = () => new Date().toISOString();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())).replace(/-/g, "").slice(0, 10);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((k) => k != null && n.append(k));
    return n;
  };
  function notice(text) { $("notice").textContent = text || ""; $("notice").hidden = !text; }
  function status(id, text, isError) { const s = $(id); s.textContent = text || ""; s.classList.toggle("error", !!isError); }

  // ---------- Google API plumbing ----------
  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${state.token}`, ...(options.headers || {}) } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error.message || msg; } catch { /* keep default */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (res.status === 204) return null;
    const type = res.headers.get("content-type") || "";
    return type.includes("json") ? res.json() : res.text();
  }
  function multipart(meta, body, bodyType) {
    const b = "carpathia" + Math.random().toString(36).slice(2);
    return {
      headers: { "Content-Type": `multipart/related; boundary=${b}` },
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${b}\r\nContent-Type: ${bodyType}; charset=UTF-8\r\n\r\n${body}\r\n--${b}--`,
    };
  }
  const DRIVE = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const SHEETS = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CFG.SHEET_ID)}`;
  const rangeUrl = (r) => `${SHEETS}/values/${encodeURIComponent(r)}`;

  // ---------- backend (real Google, or in-memory for ?demo=1) ----------
  const google_ = {
    async readActive() {
      if (state.token) {
        const data = await api(rangeUrl(`${TABS.active}!A1:M`));
        const [header = [], ...rows] = data.values || [];
        return rows.map((r) => Object.fromEntries(header.map((h, i) => [String(h).trim(), r[i] ?? ""])));
      }
      // Public read: works when the sheet is shared "Anyone with the link: Viewer".
      const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.SHEET_ID)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(TABS.active)}`;
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
      const text = await res.text();
      const json = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
      if (json.status === "error") throw new Error("Sheet is not shared publicly");
      const labels = json.table.cols.map((c) => (c.label || "").trim());
      return json.table.rows.map((r) => Object.fromEntries(labels.map((l, i) => [l, r.c[i] ? (r.c[i].v ?? "") : ""])));
    },
    async listModules() {
      const q = encodeURIComponent("appProperties has { key='carpathiaModule' and value='1' } and trashed=false");
      const data = await api(`${DRIVE}?q=${q}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,modifiedTime,appProperties)`);
      return (data.files || []).map((f) => ({ fileId: f.id, title: f.appProperties.title || f.name, status: f.appProperties.status || "Draft", modified: f.modifiedTime }));
    },
    async loadModule(fileId) {
      const text = await api(`${DRIVE}/${fileId}?alt=media`);
      return typeof text === "string" ? JSON.parse(text) : text;
    },
    async saveModule(fileId, m) {
      const meta = {
        name: `Bounty module - ${m.public.title}.json`,
        appProperties: { carpathiaModule: "1", moduleId: m.id, status: m.public.status, title: m.public.title.slice(0, 60) },
      };
      const body = JSON.stringify(m, null, 2);
      if (fileId) {
        const mp = multipart(meta, body, "application/json");
        await api(`${UPLOAD}/${fileId}?uploadType=multipart&fields=id`, { method: "PATCH", ...mp });
        return fileId;
      }
      const mp = multipart({ ...meta, mimeType: "application/json" }, body, "application/json");
      return (await api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", ...mp })).id;
    },
    async saveRunSheet(docId, m) {
      const meta = { name: `Run sheet - ${m.public.title}` };
      const html = runSheetHtml(m);
      if (docId) {
        const mp = multipart(meta, html, "text/html");
        return api(`${UPLOAD}/${docId}?uploadType=multipart&fields=id,webViewLink`, { method: "PATCH", ...mp });
      }
      const mp = multipart({ ...meta, mimeType: "application/vnd.google-apps.document" }, html, "text/html");
      return api(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, { method: "POST", ...mp });
    },
    async findActiveRow(id) {
      const data = await api(rangeUrl(`${TABS.active}!A1:A`));
      const idx = (data.values || []).findIndex((r) => String(r[0]) === id);
      return idx > 0 ? idx + 1 : 0; // 1-based sheet row; 0 = not found (row 1 is the header)
    },
    async upsertCard(m) {
      const row = cardRow(m);
      const n = await this.findActiveRow(m.id);
      if (n) {
        await api(`${rangeUrl(`${TABS.active}!A${n}:M${n}`)}?valueInputOption=RAW`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }),
        });
      } else {
        await this.append(TABS.active, [row]);
      }
    },
    async append(tab, rows) {
      await api(`${rangeUrl(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: rows }),
      });
    },
    async removeCard(id) {
      const n = await this.findActiveRow(id);
      if (!n) return;
      const meta = await api(`${SHEETS}?fields=sheets.properties(sheetId,title)`);
      const sheet = meta.sheets.find((s) => s.properties.title === TABS.active);
      await api(`${SHEETS}:batchUpdate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: "ROWS", startIndex: n - 1, endIndex: n } } }] }),
      });
    },
  };

  const demo_ = (() => {
    const files = new Map();
    const sheet = { active: [
      { id: "d1", title: "The Ledger Thief", level: 3, reward_gold: 150, status: "Open", gm_name: "Sample GM", session_time: "Sat, 21:00 ST", party_size: "3–5", location: "Dockside district", hook: "A Black Market ledger went missing with someone who shouldn't have it.", created_at: "2026-11-01" },
      { id: "d2", title: "Ashen Toll Collector", level: 6, reward_gold: 750, status: "Open", gm_name: "Sample GM", session_time: "Sun, 20:00 ST", party_size: "4–6", location: "Burned crossroads", hook: "Someone is taxing the road in our name. Find out who, and make it stop.", created_at: "2026-11-03" },
      { id: "d3", title: "The Silent Courier", level: 5, reward_gold: 400, status: "Full", gm_name: "Sample GM", session_time: "Fri, 21:30 ST", party_size: "4", location: "Mountain pass road", hook: "A courier vanished with a sealed crate. Bring back the crate. The courier is optional.", created_at: "2026-11-02" },
    ], completed: [], failed: [], players: [] };
    return {
      async readActive() { return sheet.active.slice(); },
      async listModules() { return [...files.entries()].map(([fileId, m]) => ({ fileId, title: m.public.title, status: m.public.status, modified: m.updatedAt })); },
      async loadModule(fileId) { return JSON.parse(JSON.stringify(files.get(fileId))); },
      async saveModule(fileId, m) { const id = fileId || "f" + newId(); files.set(id, JSON.parse(JSON.stringify(m))); return id; },
      async saveRunSheet(docId) { return { id: docId || "doc" + newId(), webViewLink: "#" }; },
      async upsertCard(m) { const r = Object.fromEntries(ACTIVE_COLS.map((c, i) => [c, cardRow(m)[i]])); const i = sheet.active.findIndex((x) => x.id === m.id); if (i >= 0) sheet.active[i] = r; else sheet.active.push(r); },
      async append(tab, rows) { const key = Object.keys(TABS).find((k) => TABS[k] === tab); sheet[key].push(...rows); console.log("[demo] append", tab, rows); },
      async removeCard(id) { sheet.active = sheet.active.filter((x) => x.id !== id); },
    };
  })();

  const backend = DEMO ? demo_ : google_;

  // ---------- module model ----------
  function blankModule() {
    return {
      version: 1, id: newId(), createdAt: nowIso(), updatedAt: nowIso(), docId: "", docUrl: "", published: false, closed: null,
      public: { title: "", level: 1, reward: 0, partySize: "", status: "Open", session: "", location: "", gmName: rememberedGmName(), imageUrl: "", hook: "" },
      overview: { premise: "", objective: "", duration: "", success: "", failure: "" },
      briefing: "", scenes: [], npcs: [], encounters: [], twists: "", rewards: { items: "", reputation: "" }, gmNotes: "",
    };
  }
  function rememberedGmName() { try { return localStorage.getItem("carpathia.gmName") || ""; } catch { return ""; } }
  function rememberGmName(v) { try { localStorage.setItem("carpathia.gmName", v); } catch { /* storage unavailable */ } }
  function cardRow(m) {
    const p = m.public;
    return [m.id, p.title, p.level, p.reward, p.status, p.gmName, p.session, p.partySize, p.location, p.hook, safeUrl(p.imageUrl), m.createdAt, m.updatedAt];
  }

  // ---------- repeatable sections ----------
  const REPEATERS = {
    scenes: { label: "Scene", fields: [
      ["name", "Scene name", "text"], ["location", "Location", "text"],
      ["description", "What happens", "area"], ["beats", "RP beats", "area"], ["rolls", "Rolls and checks", "area"]] },
    npcs: { label: "NPC", fields: [
      ["name", "Name", "text"], ["role", "Role", "text"], ["motivation", "Motivation", "area"], ["secret", "Secret", "area"]] },
    encounters: { label: "Enemy", fields: [
      ["name", "Enemy", "text"], ["count", "Count", "number"], ["hp", "HP each", "number"],
      ["offense", "Offense level", "tier"], ["defense", "Defense level", "tier"], ["marker", "Raid marker", "marker"],
      ["buffs", "Buffs / NDE", "area"], ["notes", "Tactics and notes", "area"]] },
  };

  function fieldInput(name, type, value) {
    if (type === "area") return el("textarea", { "data-field": name, rows: 2 }, String(value ?? ""));
    if (type === "tier" || type === "marker") {
      const opts = type === "tier" ? ["1", "2", "3"] : C.markers;
      const s = el("select", { "data-field": name }, opts.map((o) => el("option", { value: o, text: o || "None" })));
      s.value = String(value || (type === "tier" ? "1" : ""));
      return s;
    }
    return el("input", { "data-field": name, type: type === "number" ? "number" : "text", min: type === "number" ? "0" : null, value: value ?? "" });
  }

  function tierTables(item) {
    const o = item.querySelector('[data-field="offense"]').value;
    const d = item.querySelector('[data-field="defense"]').value;
    const table = (title, rows, hint) => el("div", { class: "tier" },
      el("div", { class: "tier-title", text: title }), el("div", { class: "tier-hint", text: hint }),
      el("table", {}, el("tbody", {}, rows.map(([r, out]) => el("tr", {}, el("td", { text: r }), el("td", { text: out }))))));
    return [
      table(`Players attack it: Offense ${o}`, C.offense[o], C.tierHints.offense[o]),
      table(`It attacks players: Defense ${d}`, C.defense[d], C.tierHints.defense[d]),
    ];
  }

  function addItem(listName, values = {}) {
    const def = REPEATERS[listName];
    const list = document.querySelector(`[data-list="${listName}"]`);
    const item = el("div", { class: "item" });
    const head = el("div", { class: "item-head" },
      el("span", { class: "item-title" }),
      el("button", { type: "button", class: "link-btn", text: "Remove", onclick: () => { item.remove(); renumber(listName); } }));
    const grid = el("div", { class: "item-grid" }, def.fields.map(([name, label, type]) =>
      el("label", { class: type === "area" ? "wide" : "" }, label, fieldInput(name, type, values[name]))));
    item.append(head, grid);
    if (listName === "encounters") {
      const tables = el("div", { class: "tiers" });
      const refresh = () => tables.replaceChildren(...tierTables(item));
      item.querySelectorAll('[data-field="offense"],[data-field="defense"]').forEach((s) => s.addEventListener("change", refresh));
      item.append(tables);
      refresh();
    }
    list.append(item);
    renumber(listName);
  }
  function renumber(listName) {
    document.querySelectorAll(`[data-list="${listName}"] .item-title`).forEach((t, i) => { t.textContent = `${REPEATERS[listName].label} ${i + 1}`; });
  }
  function collectList(listName) {
    return [...document.querySelectorAll(`[data-list="${listName}"] .item`)].map((item) =>
      Object.fromEntries([...item.querySelectorAll("[data-field]")].map((f) => [f.dataset.field, f.value.trim()])));
  }

  // ---------- editor ----------
  function fillEditor(m) {
    const f = $("editor");
    const p = m.public;
    const set = (n, v) => { if (f.elements[n]) f.elements[n].value = v ?? ""; };
    ["title", "partySize", "session", "location", "gmName", "imageUrl", "hook"].forEach((k) => set(k, p[k]));
    set("level", String(p.level || 1)); set("reward", p.reward); set("status", p.status === "Full" ? "Full" : "Open");
    Object.entries(m.overview).forEach(([k, v]) => set(k, v));
    set("briefing", m.briefing); set("twists", m.twists); set("items", m.rewards.items); set("reputation", m.rewards.reputation); set("gmNotes", m.gmNotes);
    Object.keys(REPEATERS).forEach((name) => {
      document.querySelector(`[data-list="${name}"]`).replaceChildren();
      (m[name] || []).forEach((v) => addItem(name, v));
    });
    $("editor-title").textContent = p.title || "New bounty";
    const doc = safeUrl(m.docUrl);
    $("open-doc").hidden = !doc; if (doc) $("open-doc").href = doc;
    $("close-out").hidden = !m.published || !!m.closed;
    $("save").textContent = m.closed ? "Save changes" : "Save and publish";
    status("save-status", m.closed ? `This bounty was closed out as ${m.closed.outcome}. Edits update your run sheet only.` : "");
  }

  function readEditor(m) {
    const f = $("editor").elements;
    const v = (n) => String(f[n].value || "").trim();
    m.public = {
      title: v("title"), level: Math.min(10, Math.max(1, toInt(v("level"), 1))), reward: Math.max(0, toInt(v("reward"), 0)),
      partySize: v("partySize"), status: m.closed ? m.closed.outcome : v("status"), session: v("session"),
      location: v("location"), gmName: v("gmName"), imageUrl: v("imageUrl"), hook: v("hook"),
    };
    m.overview = { premise: v("premise"), objective: v("objective"), duration: v("duration"), success: v("success"), failure: v("failure") };
    m.briefing = v("briefing"); m.twists = v("twists"); m.gmNotes = v("gmNotes");
    m.rewards = { items: v("items"), reputation: v("reputation") };
    Object.keys(REPEATERS).forEach((name) => { m[name] = collectList(name); });
    m.updatedAt = nowIso();
    return m;
  }

  async function onSave(e) {
    e.preventDefault();
    const m = readEditor(state.current.module);
    if (!m.public.title || !m.public.gmName) { status("save-status", "A title and your GM name are needed before publishing.", true); return; }
    rememberGmName(m.public.gmName);
    const btn = $("save"); btn.disabled = true;
    try {
      status("save-status", "Saving the module to your Drive…");
      state.current.fileId = await backend.saveModule(state.current.fileId, m);
      status("save-status", "Updating your run sheet…");
      const doc = await backend.saveRunSheet(m.docId, m);
      m.docId = doc.id; m.docUrl = doc.webViewLink || m.docUrl;
      if (!m.closed) {
        status("save-status", "Publishing the card to the board…");
        try {
          await backend.upsertCard(m);
          m.published = true;
        } catch (err) {
          await backend.saveModule(state.current.fileId, m);
          fillEditor(m);
          status("save-status", err.status === 403
            ? "Saved to your Drive, but you can't publish to the board yet. Only approved GMs can; ask an officer to add your Google account as an editor of the Bounty Records sheet."
            : `Saved to your Drive, but publishing failed: ${err.message}`, true);
          return;
        }
      }
      await backend.saveModule(state.current.fileId, m);
      fillEditor(m);
      status("save-status", m.closed ? "Saved." : "Saved and published.");
      loadBoard();
    } catch (err) {
      status("save-status", `Save failed: ${err.message}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- close out ----------
  function openCloseOut() {
    const f = $("closeout-form");
    f.reset();
    const p = state.current.module.public;
    f.elements.goldEach.value = p.reward || "";
    status("closeout-status", "");
    $("closeout-dialog").showModal();
  }

  async function onCloseOut(e) {
    e.preventDefault();
    const f = $("closeout-form").elements;
    const outcome = f.outcome.value;
    const goldEach = Math.max(0, toInt(f.goldEach.value, 0));
    const notes = String(f.notes.value || "").trim();
    const party = String(f.party.value || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [character, ...rest] = l.split(/\s+-\s+/);
      return { character: character.trim(), player: rest.join(" - ").trim() };
    });
    const m = state.current.module;
    const p = m.public;
    const date = nowIso().slice(0, 10);
    const btn = $("closeout-submit"); btn.disabled = true;
    try {
      status("closeout-status", "Filing the result…");
      const partyText = party.map((x) => x.player ? `${x.character} (${x.player})` : x.character).join(", ");
      await backend.append(outcome === "Completed" ? TABS.completed : TABS.failed,
        [[m.id, p.title, p.level, p.reward, p.gmName, p.session, partyText, nowIso(), notes]]);
      if (outcome === "Completed" && party.length) {
        status("closeout-status", "Logging the mercs…");
        await backend.append(TABS.players, party.map((x) => [x.character, x.player, m.id, p.title, p.level, goldEach, date]));
      }
      status("closeout-status", "Taking the card off the board…");
      await backend.removeCard(m.id);
      m.closed = { outcome, at: nowIso(), party, goldEach, notes };
      p.status = outcome;
      await backend.saveModule(state.current.fileId, m);
      const doc = await backend.saveRunSheet(m.docId, m);
      m.docId = doc.id;
      $("closeout-dialog").close();
      fillEditor(m);
      notice(`"${p.title}" closed out as ${outcome}.`);
      loadBoard();
    } catch (err) {
      status("closeout-status", err.status === 403
        ? "You don't have edit access to the Bounty Records sheet. Ask an officer."
        : `Close-out failed: ${err.message}. Check the sheet before retrying, part of it may have been saved.`, true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- run sheet (generated Google Doc) ----------
  function runSheetHtml(m) {
    const p = m.public;
    const para = (t) => String(t || "").split("\n").map((l) => `<p>${esc(l)}</p>`).join("") || "<p></p>";
    const kv = (k, v) => v ? `<p><b>${esc(k)}:</b> ${esc(v)}</p>` : "";
    const tierTable = (title, rows) => `<p><b>${esc(title)}</b></p><table border="1" cellpadding="4">${rows.map(([r, o]) => `<tr><td>${esc(r)}</td><td>${esc(o)}</td></tr>`).join("")}</table>`;
    return `<html><body>
<p><i>Generated by the Carpathia Bounty Board. Edit this module on the board, because changes made here are overwritten on the next save. Keep this doc private.</i></p>
<h1>${esc(p.title)}</h1>
${kv("Status", p.status)}${kv("Level", p.level)}${kv("Reward", `${p.reward} gold`)}${kv("Party size", p.partySize)}${kv("Session", p.session)}${kv("Location", p.location)}${kv("GM", p.gmName)}
<h2>Hook (public)</h2>${para(p.hook)}
<h2>Overview</h2>${kv("Objective", m.overview.objective)}${kv("Estimated length", m.overview.duration)}${kv("Success", m.overview.success)}${kv("Failure", m.overview.failure)}
<h3>Premise</h3>${para(m.overview.premise)}
<h2>Briefing</h2>${para(m.briefing)}
<h2>Scenes</h2>${m.scenes.map((s, i) => `<h3>${i + 1}. ${esc(s.name || "Scene")}</h3>${kv("Location", s.location)}${para(s.description)}${s.beats ? `<p><b>RP beats</b></p>${para(s.beats)}` : ""}${s.rolls ? `<p><b>Rolls and checks</b></p>${para(s.rolls)}` : ""}`).join("") || "<p>None yet.</p>"}
<h2>NPCs</h2>${m.npcs.map((n) => `<h3>${esc(n.name || "NPC")}</h3>${kv("Role", n.role)}${kv("Motivation", n.motivation)}${kv("Secret", n.secret)}`).join("") || "<p>None yet.</p>"}
<h2>Encounters</h2>${m.encounters.map((x) => {
      const o = x.offense || "1", d = x.defense || "1";
      return `<h3>${esc(x.name || "Enemy")}${x.count ? ` ×${esc(x.count)}` : ""}${x.marker ? ` {${esc(x.marker)}}` : ""}</h3>
${kv("HP each", x.hp)}${kv("Offense / Defense", `O${o} / D${d}`)}${kv("Buffs / NDE", x.buffs)}${kv("Tactics", x.notes)}
${tierTable(`Players attack it (Offense ${o})`, C.offense[o])}${tierTable(`It attacks players (Defense ${d})`, C.defense[d])}`;
    }).join("") || "<p>None yet.</p>"}
<h2>Twists and complications</h2>${para(m.twists)}
<h2>Rewards</h2>${kv("Gold", `${p.reward}`)}${kv("Items", m.rewards.items)}${kv("Reputation / other", m.rewards.reputation)}
<h2>GM notes</h2>${para(m.gmNotes)}
${m.closed ? `<h2>Outcome: ${esc(m.closed.outcome)}</h2>${kv("Closed", m.closed.at.slice(0, 10))}${kv("Party", m.closed.party.map((x) => x.player ? `${x.character} (${x.player})` : x.character).join(", "))}${kv("Gold per merc", m.closed.goldEach)}${para(m.closed.notes)}` : ""}
</body></html>`;
  }

  // ---------- public board ----------
  function normalize(r) {
    const s = String(r.status || "Open").trim().toLowerCase();
    return {
      id: String(r.id || ""), title: String(r.title || ""), hook: String(r.hook || ""),
      level: Math.min(10, Math.max(1, toInt(r.level, 1))), reward: Math.max(0, toInt(r.reward_gold, 0)),
      status: s === "full" ? "Full" : "Open", gm: String(r.gm_name || ""), session: String(r.session_time || ""),
      party: String(r.party_size || ""), location: String(r.location || ""), image: safeUrl(r.image_url),
      created: String(r.created_at || ""),
    };
  }

  async function loadBoard() {
    $("board").replaceChildren(el("p", { class: "empty", text: "Loading the board…" }));
    let rows = [];
    try { rows = await backend.readActive(); } catch (err) {
      console.warn(err);
      notice(state.token
        ? "Couldn't read the board sheet with your account. Ask an officer for access."
        : "The board sheet isn't readable yet. An officer needs to share it as “Anyone with the link: Viewer”.");
    }
    state.bounties = rows.map(normalize).filter((b) => b.title);
    renderBoard();
  }

  function renderBoard() {
    $("chips").replaceChildren(...STATUSES.map((s) => {
      const count = s === "All" ? state.bounties.length : state.bounties.filter((b) => b.status === s).length;
      return el("button", { type: "button", class: "chip", "aria-pressed": String(state.filter === s), text: `${s} · ${count}`,
        onclick: () => { state.filter = s; renderBoard(); } });
    }));
    const by = { newest: (a, b) => b.created.localeCompare(a.created), level: (a, b) => b.level - a.level, reward: (a, b) => b.reward - a.reward }[state.sort];
    const list = state.bounties.filter((b) => state.filter === "All" || b.status === state.filter).sort(by);
    if (!list.length) {
      $("board").replaceChildren(el("p", { class: "empty", text: state.bounties.length ? "No bounties match this filter." : "No bounties on the board right now." }));
      return;
    }
    const tpl = $("card-tpl");
    $("board").replaceChildren(...list.map((b) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const q = (s) => node.querySelector(s);
      const stamp = q(".stamp"); stamp.textContent = b.status.toUpperCase(); stamp.classList.add(b.status.toLowerCase());
      q(".card-title").textContent = b.title;
      q(".level-text").textContent = `LEVEL ${b.level}`;
      q(".pips").replaceChildren(...Array.from({ length: 10 }, (_, i) => el("i", { class: i < b.level ? "on" : "" })));
      q(".amount").textContent = `${b.reward.toLocaleString("en-US")} g`;
      q(".summary").textContent = b.hook;
      q(".facts").replaceChildren(...[["GM", b.gm], ["When", b.session], ["Party", b.party], ["Where", b.location]]
        .filter(([, v]) => v).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
      if (b.image) { const img = q(".art"); img.src = b.image; img.hidden = false; img.alt = `Poster art for ${b.title}`; }
      return node;
    }));
  }

  // ---------- my bounties ----------
  async function renderMine() {
    const box = $("mine-list");
    box.replaceChildren(el("p", { class: "muted", text: "Loading your modules…" }));
    try {
      const mods = await backend.listModules();
      if (!mods.length) { box.replaceChildren(el("p", { class: "muted", text: "You haven't written any bounties yet." })); return; }
      box.replaceChildren(...mods.map((x) => el("div", { class: "mine-row" },
        el("div", {}, el("div", { class: "mine-title", text: x.title || "Untitled" }),
          el("div", { class: "muted small", text: `${x.status} · edited ${String(x.modified || "").slice(0, 10)}` })),
        el("button", { type: "button", class: "btn btn-ghost", text: "Open", onclick: () => openModule(x.fileId) }))));
    } catch (err) {
      box.replaceChildren(el("p", { class: "muted", text: `Couldn't list your modules: ${err.message}` }));
    }
  }

  async function openModule(fileId) {
    try {
      const m = await backend.loadModule(fileId);
      state.current = { fileId, module: m };
      show("editor");
      fillEditor(m);
    } catch (err) { notice(`Couldn't open that module: ${err.message}`); }
  }
  function newModule() { state.current = { fileId: null, module: blankModule() }; show("editor"); fillEditor(state.current.module); }

  // ---------- views & auth ----------
  function show(view) {
    ["board", "mine", "editor"].forEach((v) => { $(`view-${v}`).hidden = v !== view; });
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.view === view)));
    if (view === "mine") renderMine();
    window.scrollTo(0, 0);
  }
  function setSignedIn(on) {
    $("signin").hidden = on || !state.tokenClient;
    $("signout").hidden = !on || DEMO;
    $("tabs").hidden = !on;
    $("who").hidden = !on;
    $("who").textContent = on ? (DEMO ? "Demo GM" : `Signed in as ${(state.user && (state.user.email || state.user.name)) || "GM"}`) : "";
    if (!on) show("board");
  }
  window.onGisLoaded = function () {
    if (DEMO || !CFG.GOOGLE_CLIENT_ID || !window.google || !google.accounts) return;
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.GOOGLE_CLIENT_ID, scope: SCOPES,
      callback: async (resp) => {
        if (resp.error) { notice(`Sign-in failed: ${resp.error}`); return; }
        state.token = resp.access_token;
        try { state.user = await api("https://www.googleapis.com/oauth2/v3/userinfo"); } catch { state.user = null; }
        setSignedIn(true);
        loadBoard();
      },
    });
    setSignedIn(false);
  };
  function signOut() {
    if (state.token && window.google) google.accounts.oauth2.revoke(state.token, () => {});
    state.token = null; state.user = null; state.current = null;
    setSignedIn(false); loadBoard();
  }

  function init() {
    const lvl = $("editor").elements.level;
    lvl.replaceChildren(...Array.from({ length: 10 }, (_, i) => new Option(String(i + 1))));
    $("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderBoard(); });
    $("signin").addEventListener("click", () => state.tokenClient && state.tokenClient.requestAccessToken());
    $("signout").addEventListener("click", signOut);
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
    $("new-module").addEventListener("click", newModule);
    document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addItem(b.dataset.add)));
    $("editor").addEventListener("submit", onSave);
    $("close-out").addEventListener("click", openCloseOut);
    $("closeout-form").addEventListener("submit", onCloseOut);
    $("closeout-cancel").addEventListener("click", () => $("closeout-dialog").close());
    if (DEMO) { setSignedIn(true); notice("Demo mode: sample data, nothing is saved to Google."); }
    loadBoard();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
