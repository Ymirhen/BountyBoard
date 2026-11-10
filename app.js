/* Carpathia Bounty Board: static client for GitHub Pages.
 *
 * Public: reads the "Active" tab of the Bounty Records sheet and shows wanted-poster cards.
 * GMs (signed in with Google) write one-shot modules. In the GM's own Drive the board keeps:
 *   Carpathia Bounty Board/
 *     Module data/       one JSON file per module (the source of truth the builder loads and saves)
 *     Session modules/   a printable, one-shot style PDF per module, regenerated on every save
 * Publishing upserts the module's card in the Active tab; closing out archives it to Completed/Failed
 * and logs every merc. Only editors of the sheet can write to it, which is what makes someone a GM. */
(function () {
  "use strict";

  const CFG = window.BOARD_CONFIG || {};
  const TABS = CFG.TABS || { active: "Active", completed: "Completed", failed: "Failed", players: "Completed by players" };
  const C = window.CARPATHIA;
  const ACTIVE_COLS = ["id", "title", "level", "initial_reward", "final_reward", "status", "gm_name", "session_time",
    "location", "hook", "image_url", "created_at", "updated_at"];
  const STATUSES = ["All", "Open", "Full"];
  const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",   // the GM's own board folder and files (only files this app created)
    "https://www.googleapis.com/auth/spreadsheets", // publish cards and archive results in the Bounty Records sheet
    "openid", "email", "profile",
  ].join(" ");
  const DEMO = new URLSearchParams(location.search).has("demo");

  const state = {
    bounties: [], filter: "All", sort: "newest",
    token: null, user: null, tokenClient: null, folders: null,
    current: null, // { fileId, module }
    cardUnit: null,
  };
  const $ = (id) => document.getElementById(id);

  // ---------- small helpers ----------
  const safeUrl = (v) => { try { const u = new URL(String(v || "").trim()); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };
  const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
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
  function downloadBlob(blob, name) {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const pdfName = (m) => `${(m.public.title || "Untitled bounty").replace(/[\\/:*?"<>|]+/g, "")} - Session module.pdf`;

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
      body: new Blob([
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${bodyType}\r\n\r\n`,
        body, `\r\n--${b}--`]),
    };
  }
  const DRIVE = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const FOLDER = "application/vnd.google-apps.folder";
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

    // The GM's board folder and its two subfolders, created on first use and found again by tag.
    async folders() {
      if (state.folders) return state.folders;
      const find = async (role, parent) => {
        let q = `mimeType='${FOLDER}' and appProperties has { key='carpathiaFolder' and value='${role}' } and trashed=false`;
        if (parent) q += ` and '${parent}' in parents`;
        const data = await api(`${DRIVE}?q=${encodeURIComponent(q)}&pageSize=1&fields=files(id)`);
        return data.files && data.files[0] ? data.files[0].id : "";
      };
      const create = async (name, role, parent) => (await api(`${DRIVE}?fields=id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER, appProperties: { carpathiaFolder: role }, ...(parent ? { parents: [parent] } : {}) }),
      })).id;
      const root = (await find("root")) || (await create("Carpathia Bounty Board", "root"));
      const data = (await find("data", root)) || (await create("Module data", "data", root));
      const pdf = (await find("pdf", root)) || (await create("Session modules", "pdf", root));
      state.folders = { root, data, pdf };
      return state.folders;
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
      const { data } = await this.folders();
      const meta = {
        name: `${m.public.title || "Untitled bounty"}.json`,
        appProperties: { carpathiaModule: "1", moduleId: m.id, status: m.public.status, title: (m.public.title || "").slice(0, 60) },
      };
      const body = JSON.stringify(m, null, 2);
      if (fileId) {
        // Move older modules (saved before folders existed) into Module data.
        const { parents = [] } = await api(`${DRIVE}/${fileId}?fields=parents`);
        const move = parents.includes(data) ? "" : `&addParents=${data}&removeParents=${parents.join(",")}`;
        await api(`${UPLOAD}/${fileId}?uploadType=multipart&fields=id${move}`, { method: "PATCH", ...multipart(meta, body, "application/json") });
        return fileId;
      }
      return (await api(`${UPLOAD}?uploadType=multipart&fields=id`, {
        method: "POST", ...multipart({ ...meta, mimeType: "application/json", parents: [data] }, body, "application/json"),
      })).id;
    },
    async savePdf(pdfId, m, blob) {
      const { pdf } = await this.folders();
      const meta = { name: pdfName(m) };
      if (pdfId) {
        try {
          return await api(`${UPLOAD}/${pdfId}?uploadType=multipart&fields=id,webViewLink`, { method: "PATCH", ...multipart(meta, blob, "application/pdf") });
        } catch (err) { if (err.status !== 404) throw err; } // deleted by the GM: make a new one
      }
      return api(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
        method: "POST", ...multipart({ ...meta, mimeType: "application/pdf", parents: [pdf] }, blob, "application/pdf"),
      });
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
      } else await this.append(TABS.active, [row]);
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
      { id: "d1", title: "The Ledger Thief", level: 3, initial_reward: 150, status: "Open", gm_name: "Sample GM", session_time: "Sat, 21:00 ST", location: "Dockside district", hook: "A Black Market ledger went missing with someone who shouldn't have it.", created_at: "2026-11-01" },
      { id: "d2", title: "Ashen Toll Collector", level: 6, initial_reward: 750, status: "Open", gm_name: "Sample GM", session_time: "Sun, 20:00 ST", location: "Burned crossroads", hook: "Someone is taxing the road in our name. Find out who, and make it stop.", created_at: "2026-11-03" },
      { id: "d3", title: "The Silent Courier", level: 5, initial_reward: 400, status: "Full", gm_name: "Sample GM", session_time: "Fri, 21:30 ST", location: "Mountain pass road", hook: "A courier vanished with a sealed crate. Bring back the crate. The courier is optional.", created_at: "2026-11-02" },
      { id: "d4", title: "The Gilded Debt", level: 9, initial_reward: 2400, status: "Open", gm_name: "Sample GM", session_time: "Sat, 22:00 ST", location: "Booty Bay", hook: "A Steamwheedle banker owes the Market more than gold. Collect it, quietly.", created_at: "2026-11-04" },
      { id: "d5", title: "Rats in the Cellar", level: 0, initial_reward: 20, status: "Open", gm_name: "Sample GM", session_time: "Any evening", location: "The Back Door tavern", hook: "Something is eating the stock. Probably rats. Probably.", created_at: "2026-11-05" },
      { id: "d6", title: "Wolves at Hollow Mill", level: 3, initial_reward: 90, status: "Full", gm_name: "Sample GM", session_time: "Thu, 20:00 ST", location: "Hollow Mill", hook: "The miller pays in flour and favours. The Market pays in coin.", created_at: "2026-11-06" },
      { id: "d7", title: "The Pale Magistrate", level: 10, initial_reward: 5000, status: "Open", gm_name: "Sample GM", session_time: "Sun, 21:00 ST", location: "Unknown", hook: "No one who has seen the Magistrate's face has spoken of it. Be the first.", created_at: "2026-11-07" },
      { id: "d8", title: "Smoke over Ratchet", level: 6, initial_reward: 650, status: "Open", gm_name: "Sample GM", session_time: "Fri, 22:00 ST", location: "Ratchet docks", hook: "A warehouse burned with our goods inside. Find who lit it.", created_at: "2026-11-07" },
    ], completed: [], failed: [], players: [] };
    window.__demoSheet = sheet;
    return {
      async readActive() { return sheet.active.slice(); },
      async listModules() { return [...files.entries()].map(([fileId, m]) => ({ fileId, title: m.public.title, status: m.public.status, modified: m.updatedAt })); },
      async loadModule(fileId) { return JSON.parse(JSON.stringify(files.get(fileId))); },
      async saveModule(fileId, m) { const id = fileId || "f" + newId(); files.set(id, JSON.parse(JSON.stringify(m))); return id; },
      async savePdf(pdfId, m, blob) { window.__demoPdf = blob; return { id: pdfId || "pdf" + newId(), webViewLink: URL.createObjectURL(blob) }; },
      async upsertCard(m) { const r = Object.fromEntries(ACTIVE_COLS.map((c, i) => [c, cardRow(m)[i]])); const i = sheet.active.findIndex((x) => x.id === m.id); if (i >= 0) sheet.active[i] = r; else sheet.active.push(r); },
      async append(tab, rows) { const key = Object.keys(TABS).find((k) => TABS[k] === tab); sheet[key].push(...rows); },
      async removeCard(id) { sheet.active = sheet.active.filter((x) => x.id !== id); },
    };
  })();

  const backend = DEMO ? demo_ : google_;

  // ---------- module model ----------
  function blankModule() {
    return {
      version: 2, id: newId(), createdAt: nowIso(), updatedAt: nowIso(), pdfId: "", pdfUrl: "", published: false, closed: null,
      public: { title: "", level: 1, initialReward: 0, finalReward: "", status: "Open", session: "", location: "", gmName: rememberedGmName(), imageUrl: "", hook: "" },
      overview: { premise: "", objective: "", success: "", failure: "" },
      briefing: "", scenes: [], npcs: [], enemies: [], twists: "", rewards: { items: "", reputation: "" }, gmNotes: "",
    };
  }
  // Upgrade modules saved by the first version of the builder.
  function migrate(m) {
    if (m.version >= 2) return m;
    const p = m.public || {};
    m.public = { ...p, initialReward: p.initialReward ?? p.reward ?? 0, finalReward: p.finalReward ?? "" };
    delete m.public.reward; delete m.public.partySize;
    if (m.overview) delete m.overview.duration;
    m.npcs = (m.npcs || []).map((n) => ({ name: n.name, title: n.role, motivation: n.motivation, secret: n.secret, combat: false }));
    m.enemies = (m.encounters || []).map((e) => ({ name: e.name, hp: e.hp, offense: e.offense, defense: e.defense, marker: e.marker, positive: e.buffs, notes: e.notes }));
    delete m.encounters;
    if (m.docId) { m.legacyDocId = m.docId; delete m.docId; delete m.docUrl; }
    m.version = 2;
    return m;
  }
  function rememberedGmName() { try { return localStorage.getItem("carpathia.gmName") || ""; } catch { return ""; } }
  function rememberGmName(v) { try { localStorage.setItem("carpathia.gmName", v); } catch { /* storage unavailable */ } }
  function cardRow(m) {
    const p = m.public;
    return [m.id, p.title, p.level, p.initialReward, p.finalReward ?? "", p.status, p.gmName, p.session, p.location, p.hook, safeUrl(p.imageUrl), m.createdAt, m.updatedAt];
  }

  // ---------- scenes ----------
  const SCENE_FIELDS = [["name", "Scene name", "text"], ["location", "Location", "text"],
    ["description", "What happens", "area"], ["beats", "RP beats", "area"], ["rolls", "Rolls and checks", "area"]];

  function input(name, type, value, extra = {}) {
    if (type === "area") return el("textarea", { "data-field": name, rows: extra.rows || 2, placeholder: extra.placeholder }, String(value ?? ""));
    if (type === "check") { const c = el("input", { type: "checkbox", "data-field": name }); c.checked = !!value; return c; }
    if (type === "tier") {
      const s = el("select", { "data-field": name }, ["1", "2", "3"].map((o) => el("option", { value: o, text: o })));
      s.value = String(value || "1"); return s;
    }
    if (type === "marker") {
      const s = el("select", { "data-field": name }, C.markers.map(([n, sym]) => el("option", { value: n, text: n ? `${sym} ${n}` : "None" })));
      s.value = value || ""; return s;
    }
    return el("input", { "data-field": name, type: type === "number" ? "number" : type === "url" ? "url" : "text", min: type === "number" ? "0" : null, placeholder: extra.placeholder, value: value ?? "" });
  }
  const field = (label, node, cls) => el("label", { class: cls || "" }, label, node);

  function itemShell(listName, label) {
    const item = el("div", { class: "item" });
    const head = el("div", { class: "item-head" }, el("span", { class: "item-title" }));
    const tools = el("div", { class: "item-tools" });
    head.append(tools);
    tools.append(el("button", { type: "button", class: "link-btn", text: "Remove", onclick: () => { item.remove(); renumber(listName, label); } }));
    item.append(head);
    return { item, tools };
  }
  function renumber(listName, label) {
    document.querySelectorAll(`[data-list="${listName}"] .item-title`).forEach((t, i) => { t.textContent = `${label} ${i + 1}`; });
  }

  function addScene(v = {}) {
    const { item } = itemShell("scenes", "Scene");
    item.append(el("div", { class: "item-grid" }, SCENE_FIELDS.map(([n, l, t]) => field(l, input(n, t, v[n]), t === "area" ? "wide" : ""))));
    document.querySelector('[data-list="scenes"]').append(item);
    renumber("scenes", "Scene");
  }

  // ---------- NPCs and enemies (units) ----------
  function tierTables(get) {
    const o = get("offense"), d = get("defense");
    const table = (title, rows, hint) => el("div", { class: "tier" },
      el("div", { class: "tier-title", text: title }), hint ? el("div", { class: "tier-hint", text: hint }) : null,
      el("table", {}, el("tbody", {}, rows.map(([r, out]) => el("tr", {}, el("td", { text: r }), el("td", { text: out }))))));
    const out = [
      table(`Players attack it: Offense ${o}`, C.offense[o], C.tierHints.offense[o]),
      table(`It attacks players: Defense ${d}`, C.defense[d], C.tierHints.defense[d]),
    ];
    if (get("healing")) out.push(table(`Healing (level ${get("healingLevel")})`, C.healing, "Carpathia healing roll"));
    if (get("buff")) out.push(table(`Buff (level ${get("buffLevel")})`, C.buffing, "Carpathia buffing roll"));
    return out;
  }

  function readUnit(item) {
    const u = {};
    item.querySelectorAll("[data-field]").forEach((f) => { u[f.dataset.field] = f.type === "checkbox" ? f.checked : f.value.trim(); });
    return u;
  }

  function addUnit(kind, v = {}) {
    const listName = kind === "enemy" ? "enemies" : "npcs";
    const label = kind === "enemy" ? "Enemy" : "NPC";
    const { item, tools } = itemShell(listName, label);
    item.dataset.kind = kind;
    tools.prepend(el("button", { type: "button", class: "link-btn", text: "Unit card", onclick: () => openCard(readUnit(item), kind) }));

    item.append(el("div", { class: "item-grid" },
      field("Name", input("name", "text", v.name)),
      field(kind === "enemy" ? "Title (e.g. Bloodsail Captain)" : "Title / role", input("title", "text", v.title)),
      field("Portrait image URL", input("imageUrl", "url", v.imageUrl, { placeholder: "https://i.ibb.co/…/portrait.png" }), "span2"),
      field("HP", input("hp", "number", v.hp)),
      field("Raid marker", input("marker", "marker", v.marker))));

    const combat = el("div", { class: "combat" });
    if (kind === "npc") {
      const toggle = input("combat", "check", v.combat);
      item.append(el("label", { class: "check" }, toggle, "Has combat stats (Offense / Defense, healing, buffs)"));
      const sync = () => { combat.hidden = !toggle.checked; };
      toggle.addEventListener("change", sync);
      queueMicrotask(sync);
    }
    const healing = input("healing", "check", v.healing), healingLevel = input("healingLevel", "tier", v.healingLevel);
    const buff = input("buff", "check", v.buff), buffLevel = input("buffLevel", "tier", v.buffLevel);
    combat.append(el("div", { class: "item-grid" },
      field("Offense level", input("offense", "tier", v.offense)),
      field("Defense level", input("defense", "tier", v.defense)),
      el("div", { class: "toggle-level" }, el("label", { class: "check" }, healing, "Heals"), field("Healing level", healingLevel)),
      el("div", { class: "toggle-level" }, el("label", { class: "check" }, buff, "Buffs"), field("Buff level", buffLevel))));
    const tables = el("div", { class: "tiers" });
    combat.append(tables);
    item.append(combat);

    item.append(el("div", { class: "item-grid" },
      field("Positive traits (one per line, \"Name: effect\")", input("positive", "area", v.positive, { rows: 3 }), "half"),
      field("Negative traits (one per line, \"Name: effect\")", input("negative", "area", v.negative, { rows: 3 }), "half"),
      field("Card description (shown on the unit card)", input("description", "area", v.description), "wide"),
      ...(kind === "npc"
        ? [field("Motivation (GM only)", input("motivation", "area", v.motivation), "half"), field("Secret (GM only)", input("secret", "area", v.secret), "half")]
        : [field("Tactics and notes (GM only)", input("notes", "area", v.notes), "wide")])));

    const refresh = () => {
      const get = (n) => { const f = item.querySelector(`[data-field="${n}"]`); return f.type === "checkbox" ? f.checked : f.value; };
      healingLevel.disabled = !healing.checked; buffLevel.disabled = !buff.checked;
      tables.replaceChildren(...tierTables(get));
    };
    item.querySelectorAll('[data-field="offense"],[data-field="defense"],[data-field="healing"],[data-field="buff"],[data-field="healingLevel"],[data-field="buffLevel"]')
      .forEach((s) => s.addEventListener("change", refresh));
    refresh();

    document.querySelector(`[data-list="${listName}"]`).append(item);
    renumber(listName, label);
  }

  // ---------- unit card dialog ----------
  function openCard(unit, kind) {
    state.cardUnit = { unit, kind };
    const preview = $("card-preview");
    const card = window.UnitCard.render(unit, kind);
    const holder = el("div", { class: "card-scale" }, card);
    preview.replaceChildren(holder);
    status("card-status", "");
    $("card-dialog").showModal();
    const fit = () => {
      const s = Math.min(1, preview.clientWidth / 1000);
      card.style.transform = `scale(${s})`;
      holder.style.height = `${620 * s}px`;
    };
    requestAnimationFrame(fit);
  }
  async function downloadCard() {
    const { unit, kind } = state.cardUnit;
    const btn = $("card-download"); btn.disabled = true;
    try {
      status("card-status", "Rendering…");
      const ok = await window.UnitCard.download(unit, kind);
      status("card-status", ok ? "Downloaded." : "Downloaded, but the portrait host doesn't allow exporting, so the image may be blank. Try an i.ibb.co direct link.", !ok);
    } catch (err) {
      status("card-status", `Couldn't render the card: ${err.message}`, true);
    } finally { btn.disabled = false; }
  }

  // ---------- editor ----------
  function fillEditor(m) {
    const f = $("editor");
    const p = m.public;
    const set = (n, v) => { if (f.elements[n]) f.elements[n].value = v ?? ""; };
    ["title", "session", "location", "gmName", "imageUrl", "hook"].forEach((k) => set(k, p[k]));
    set("level", String(p.level ?? 1)); set("initialReward", p.initialReward); set("status", p.status === "Full" ? "Full" : "Open");
    ["premise", "objective", "success", "failure"].forEach((k) => set(k, (m.overview || {})[k]));
    set("briefing", m.briefing); set("twists", m.twists); set("items", (m.rewards || {}).items); set("reputation", (m.rewards || {}).reputation); set("gmNotes", m.gmNotes);
    ["scenes", "npcs", "enemies"].forEach((n) => document.querySelector(`[data-list="${n}"]`).replaceChildren());
    (m.scenes || []).forEach((v) => addScene(v));
    (m.npcs || []).forEach((v) => addUnit("npc", v));
    (m.enemies || []).forEach((v) => addUnit("enemy", v));
    $("editor-title").textContent = p.title || "New bounty";
    const pdf = m.pdfUrl && (DEMO || safeUrl(m.pdfUrl)) ? m.pdfUrl : "";
    $("open-pdf").hidden = !pdf; if (pdf) $("open-pdf").href = pdf;
    $("close-out").hidden = !m.published || !!m.closed;
    $("save").textContent = m.closed ? "Save changes" : "Save and publish";
    status("save-status", m.closed ? `This bounty was closed out as ${m.closed.outcome}. Edits update your files only.` : "");
  }

  function readEditor(m) {
    const f = $("editor").elements;
    const v = (n) => String(f[n].value || "").trim();
    m.public = {
      title: v("title"), level: Math.min(10, Math.max(0, toInt(v("level"), 1))), initialReward: Math.max(0, toInt(v("initialReward"), 0)),
      finalReward: m.public.finalReward ?? "", status: m.closed ? m.closed.outcome : v("status"), session: v("session"),
      location: v("location"), gmName: v("gmName"), imageUrl: v("imageUrl"), hook: v("hook"),
    };
    m.overview = { premise: v("premise"), objective: v("objective"), success: v("success"), failure: v("failure") };
    m.briefing = v("briefing"); m.twists = v("twists"); m.gmNotes = v("gmNotes");
    m.rewards = { items: v("items"), reputation: v("reputation") };
    m.scenes = [...document.querySelectorAll('[data-list="scenes"] .item')].map(readUnit);
    m.npcs = [...document.querySelectorAll('[data-list="npcs"] .item')].map(readUnit);
    m.enemies = [...document.querySelectorAll('[data-list="enemies"] .item')].map(readUnit);
    m.updatedAt = nowIso();
    return m;
  }

  async function refreshPdf(m) {
    const blob = await window.ModulePdf.toBlob(m);
    const file = await backend.savePdf(m.pdfId, m, blob);
    m.pdfId = file.id; m.pdfUrl = file.webViewLink || m.pdfUrl;
  }

  async function onSave(e) {
    e.preventDefault();
    const m = readEditor(state.current.module);
    if (!m.public.title || !m.public.gmName) { status("save-status", "A title and your GM name are needed before publishing.", true); return; }
    rememberGmName(m.public.gmName);
    const btn = $("save"); btn.disabled = true;
    const warnings = [];
    try {
      status("save-status", "Saving the module to your Drive…");
      state.current.fileId = await backend.saveModule(state.current.fileId, m);
      status("save-status", "Laying out the session module PDF…");
      try { await refreshPdf(m); } catch (err) { console.warn(err); warnings.push(`the PDF couldn't be made (${err.message})`); }
      if (!m.closed) {
        status("save-status", "Publishing the card to the board…");
        try { await backend.upsertCard(m); m.published = true; } catch (err) {
          warnings.push(err.status === 403
            ? "you can't publish to the board yet. Only approved GMs can; ask an officer to add your Google account as an editor of the Bounty Records sheet"
            : `publishing failed (${err.message})`);
        }
      }
      await backend.saveModule(state.current.fileId, m);
      fillEditor(m);
      status("save-status", warnings.length ? `Saved to your Drive, but ${warnings.join("; and ")}.` : (m.closed ? "Saved." : "Saved and published."), warnings.length > 0);
      loadBoard();
    } catch (err) {
      status("save-status", `Save failed: ${err.message}`, true);
    } finally { btn.disabled = false; }
  }

  async function onDownloadPdf() {
    const m = readEditor(JSON.parse(JSON.stringify(state.current.module)));
    const btn = $("download-pdf"); btn.disabled = true;
    try {
      status("save-status", "Laying out the session module PDF…");
      downloadBlob(await window.ModulePdf.toBlob(m), pdfName(m));
      status("save-status", "PDF downloaded. It hasn't been saved to Drive; use Save for that.");
    } catch (err) { status("save-status", `Couldn't make the PDF: ${err.message}`, true); } finally { btn.disabled = false; }
  }

  // ---------- close out ----------
  function openCloseOut() {
    const f = $("closeout-form");
    f.reset();
    const p = state.current.module.public;
    f.elements.finalReward.value = p.initialReward ?? "";
    f.elements.goldEach.value = "";
    status("closeout-status", "");
    $("closeout-dialog").showModal();
  }

  async function onCloseOut(e) {
    e.preventDefault();
    const f = $("closeout-form").elements;
    const outcome = f.outcome.value;
    const finalReward = Math.max(0, toInt(f.finalReward.value, 0));
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
        [[m.id, p.title, p.level, p.initialReward, finalReward, p.gmName, p.session, partyText, nowIso(), notes]]);
      if (outcome === "Completed" && party.length) {
        status("closeout-status", "Logging the mercs…");
        await backend.append(TABS.players, party.map((x) => [x.character, x.player, m.id, p.title, p.level, goldEach, date]));
      }
      status("closeout-status", "Taking the card off the board…");
      await backend.removeCard(m.id);
      m.closed = { outcome, at: nowIso(), party, goldEach, notes };
      p.status = outcome; p.finalReward = finalReward;
      await backend.saveModule(state.current.fileId, m);
      status("closeout-status", "Updating the session module PDF…");
      try { await refreshPdf(m); await backend.saveModule(state.current.fileId, m); } catch (err) { console.warn(err); }
      $("closeout-dialog").close();
      fillEditor(m);
      notice(`"${p.title}" closed out as ${outcome}.`);
      loadBoard();
    } catch (err) {
      status("closeout-status", err.status === 403
        ? "You don't have edit access to the Bounty Records sheet. Ask an officer."
        : `Close-out failed: ${err.message}. Check the sheet before retrying, part of it may have been saved.`, true);
    } finally { btn.disabled = false; }
  }

  // ---------- public board ----------
  function normalize(r) {
    const s = String(r.status || "Open").trim().toLowerCase();
    return {
      id: String(r.id || ""), title: String(r.title || ""), hook: String(r.hook || ""),
      level: Math.min(10, Math.max(0, toInt(r.level, 1))), reward: Math.max(0, toInt(r.initial_reward ?? r.reward_gold, 0)),
      status: s === "full" ? "Full" : "Open", gm: String(r.gm_name || ""), session: String(r.session_time || ""),
      location: String(r.location || ""), image: safeUrl(r.image_url), created: String(r.created_at || ""),
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
    const wall = state.view === "wall";
    $("wall-viewport").hidden = !wall;
    $("board").hidden = wall;
    $("sort-wrap").hidden = wall;
    $("view-toggle").textContent = wall ? "List view" : "Wall view";
    $("view-toggle").setAttribute("aria-pressed", String(!wall));
    if (wall) { window.BountyWall.render(state.bounties, state.filter); return; }
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
      q(".facts").replaceChildren(...[["GM", b.gm], ["When", b.session], ["Where", b.location]]
        .filter(([, v]) => v).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
      if (b.image) {
        const img = q(".art"); img.src = b.image; img.hidden = false; img.alt = `Poster art for ${b.title}`;
        img.addEventListener("error", () => { img.hidden = true; }, { once: true });
      }
      return node;
    }));
  }

  function openBounty(b) {
    const stamp = $("bd-stamp");
    stamp.className = "bd-seal"; stamp.replaceChildren(window.BountyWall.seal(b.status));
    $("bd-title").textContent = b.title;
    $("bd-coins").replaceWith(Object.assign(window.BountyWall.koban(b.level, "big"), { id: "bd-coins" }));
    $("bd-level-text").textContent = `Level ${b.level}`;
    $("bd-amount").textContent = `${b.reward.toLocaleString("en-US")} gold`;
    $("bd-hook").textContent = b.hook;
    $("bd-facts").replaceChildren(...[["GM", b.gm], ["When", b.session], ["Where", b.location]]
      .filter(([, v]) => v).flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
    const art = $("bd-art");
    art.hidden = !b.image; art.removeAttribute("src");
    if (b.image) { art.src = b.image; art.alt = `Poster art for ${b.title}`; art.onerror = () => { art.hidden = true; }; }
    $("bounty-dialog").showModal();
  }
  function rememberedView() { try { return localStorage.getItem("carpathia.view") === "list" ? "list" : "wall"; } catch { return "wall"; } }
  function toggleView() {
    state.view = state.view === "wall" ? "list" : "wall";
    try { localStorage.setItem("carpathia.view", state.view); } catch { /* storage unavailable */ }
    renderBoard();
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
      const m = migrate(await backend.loadModule(fileId));
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
    state.token = null; state.user = null; state.current = null; state.folders = null;
    setSignedIn(false); loadBoard();
  }

  function init() {
    const lvl = $("editor").elements.level;
    lvl.replaceChildren(...Array.from({ length: 11 }, (_, i) => new Option(String(i))));
    lvl.value = "1";
    $("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderBoard(); });
    state.view = rememberedView();
    window.BountyWall.init({ viewport: $("wall-viewport"), world: $("wall-world"), hint: $("wall-hint"), onOpen: openBounty });
    $("view-toggle").addEventListener("click", toggleView);
    $("bd-close").addEventListener("click", () => $("bounty-dialog").close());
    $("signin").addEventListener("click", () => state.tokenClient && state.tokenClient.requestAccessToken());
    $("signout").addEventListener("click", signOut);
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
    $("new-module").addEventListener("click", newModule);
    document.querySelector('[data-add="scenes"]').addEventListener("click", () => addScene());
    document.querySelector('[data-add="npcs"]').addEventListener("click", () => addUnit("npc"));
    document.querySelector('[data-add="enemies"]').addEventListener("click", () => addUnit("enemy"));
    $("editor").addEventListener("submit", onSave);
    $("download-pdf").addEventListener("click", onDownloadPdf);
    $("close-out").addEventListener("click", openCloseOut);
    $("closeout-form").addEventListener("submit", onCloseOut);
    $("closeout-cancel").addEventListener("click", () => $("closeout-dialog").close());
    $("card-download").addEventListener("click", downloadCard);
    $("card-close").addEventListener("click", () => $("card-dialog").close());
    if (DEMO) { setSignedIn(true); notice("Demo mode: sample data, nothing is saved to Google."); }
    loadBoard();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
