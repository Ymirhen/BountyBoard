/* Carpathia Bounty Board: static client for GitHub Pages.
 * Reads bounty summaries from a Google Sheet; posting uses Google sign-in in the browser.
 * No server: Google Drive permissions decide who can open each private details doc. */
(function () {
  "use strict";

  const CFG = window.BOARD_CONFIG || {};
  const COLUMNS = ["id", "title", "level", "reward_gold", "status", "poster_name", "location",
    "summary", "details_doc_url", "image_url", "created_at", "approved"];
  const STATUSES = ["All", "Open", "Claimed", "Completed"];
  const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",   // create the private details doc in the poster's Drive
    "https://www.googleapis.com/auth/spreadsheets", // append the public summary row to the board sheet
    "openid", "email", "profile",
  ].join(" ");

  const state = { bounties: [], filter: "All", sort: "newest", token: null, user: null, tokenClient: null };
  const $ = (id) => document.getElementById(id);
  const demo = new URLSearchParams(location.search).has("demo");

  // ---------- helpers ----------
  function safeUrl(value) {
    try {
      const u = new URL(String(value || "").trim());
      return u.protocol === "https:" ? u.href : "";
    } catch { return ""; }
  }
  function isTrue(v) { return v === true || String(v).trim().toUpperCase() === "TRUE"; }
  function toInt(v, fallback) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : fallback; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function notice(text) {
    const el = $("notice");
    el.textContent = text || "";
    el.hidden = !text;
  }
  function normalize(row) {
    const b = {};
    COLUMNS.forEach((c) => { b[c] = row[c] == null ? "" : row[c]; });
    b.level = Math.min(10, Math.max(1, toInt(b.level, 1)));
    b.reward_gold = Math.max(0, toInt(b.reward_gold, 0));
    const s = String(b.status || "Open").trim().toLowerCase();
    b.status = s === "claimed" ? "Claimed" : s === "completed" ? "Completed" : "Open";
    b.approved = isTrue(b.approved);
    return b;
  }

  // ---------- reading the sheet ----------
  async function readPublic() {
    // Works when the sheet is shared "Anyone with the link: Viewer" (or published).
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.SHEET_ID)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(CFG.SHEET_TAB)}`;
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
    const text = await res.text();
    const json = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
    if (json.status === "error") throw new Error("Sheet is not shared publicly");
    const labels = json.table.cols.map((c) => (c.label || "").trim());
    return json.table.rows.map((r) => {
      const o = {};
      labels.forEach((l, i) => { const cell = r.c[i]; o[l] = cell ? (cell.v ?? "") : ""; });
      return o;
    });
  }

  async function readWithToken() {
    const range = encodeURIComponent(`${CFG.SHEET_TAB}!A1:L`);
    const data = await api(`https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/${range}`);
    const [header = [], ...rows] = data.values || [];
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
  }

  function demoRows() {
    return [
      { id: "d1", title: "The Ledger Thief", level: 3, reward_gold: 150, status: "Open", poster_name: "Sample poster", location: "Dockside district", summary: "A Black Market ledger went missing with someone who shouldn't have it.", approved: true, created_at: "2026-11-01" },
      { id: "d2", title: "Ashen Toll Collector", level: 6, reward_gold: 750, status: "Open", poster_name: "Sample poster", location: "Burned crossroads", summary: "Someone is taxing the road in our name. Find out who.", approved: true, created_at: "2026-11-03" },
      { id: "d3", title: "The Silent Courier", level: 5, reward_gold: 400, status: "Claimed", poster_name: "Sample poster", location: "Mountain pass road", summary: "A courier vanished with a sealed crate. Recover the crate.", approved: true, created_at: "2026-11-02" },
    ];
  }

  async function loadBoard() {
    notice("");
    $("board").replaceChildren(emptyMessage("Loading the board…"));
    let rows;
    try {
      if (demo) rows = demoRows();
      else if (state.token) rows = await readWithToken();
      else rows = await readPublic();
    } catch (err) {
      console.warn(err);
      rows = [];
      notice(state.token
        ? "Couldn't read the board sheet with your account. Ask an officer to give you access to the board sheet."
        : "The board sheet isn't readable yet. An officer needs to share it as “Anyone with the link: Viewer”, or sign in with a guild account.");
    }
    if (demo) notice("Showing sample bounties (demo mode).");
    state.bounties = rows.map(normalize).filter((b) => b.title && (b.approved || !CFG.REQUIRE_APPROVAL));
    render();
  }

  // ---------- rendering ----------
  function emptyMessage(text) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    return p;
  }

  function renderChips() {
    const wrap = $("chips");
    wrap.replaceChildren(...STATUSES.map((s) => {
      const count = s === "All" ? state.bounties.length : state.bounties.filter((b) => b.status === s).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = `${s} · ${count}`;
      btn.setAttribute("aria-pressed", String(state.filter === s));
      btn.addEventListener("click", () => { state.filter = s; render(); });
      return btn;
    }));
  }

  function render() {
    renderChips();
    let list = state.bounties.filter((b) => state.filter === "All" || b.status === state.filter);
    const by = {
      newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
      level: (a, b) => b.level - a.level,
      reward: (a, b) => b.reward_gold - a.reward_gold,
    }[state.sort];
    list = list.slice().sort(by);
    const board = $("board");
    if (!list.length) {
      board.replaceChildren(emptyMessage(state.bounties.length ? "No bounties match this filter." : "No bounties posted yet."));
      return;
    }
    const tpl = $("card-tpl");
    board.replaceChildren(...list.map((b) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const q = (sel) => node.querySelector(sel);
      const stamp = q(".stamp");
      stamp.textContent = b.status.toUpperCase();
      stamp.classList.add(b.status.toLowerCase());
      q(".card-title").textContent = b.title;
      q(".level-text").textContent = `LEVEL ${b.level}`;
      q(".pips").replaceChildren(...Array.from({ length: 10 }, (_, i) => {
        const pip = document.createElement("i");
        if (i < b.level) pip.className = "on";
        return pip;
      }));
      q(".amount").textContent = `${b.reward_gold.toLocaleString("en-US")} g`;
      q(".summary").textContent = b.summary;
      q(".poster").textContent = b.poster_name ? `Posted by ${b.poster_name}` : "";
      q(".location").textContent = b.location;
      const art = safeUrl(b.image_url);
      if (art) { const img = q(".art"); img.src = art; img.hidden = false; img.alt = `Poster art for ${b.title}`; }
      const link = q(".details-link");
      const docUrl = safeUrl(b.details_doc_url);
      if (docUrl) link.href = docUrl; else link.remove();
      return node;
    }));
  }

  // ---------- Google sign-in ----------
  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${state.token}`, ...(options.headers || {}) },
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = (await res.json()).error.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  function setSignedIn(on) {
    $("signin").hidden = on || !state.tokenClient;
    $("signout").hidden = !on;
    $("open-post").hidden = !on;
    $("who").hidden = !on;
    $("who").textContent = on && state.user ? `Signed in as ${state.user.name || state.user.email}` : "";
  }

  window.onGisLoaded = function () {
    if (!CFG.GOOGLE_CLIENT_ID || !window.google || !google.accounts) return;
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.GOOGLE_CLIENT_ID,
      scope: SCOPES,
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
    state.token = null;
    state.user = null;
    setSignedIn(false);
    loadBoard();
  }

  // ---------- posting ----------
  function detailsDocHtml(f) {
    const p = (label, value) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value || "")}</p>`;
    return `<html><body>
      <p><b>KEEP THIS DOC PRIVATE.</b> Share it only with GMs and the players running this bounty. Never set it to "Anyone with the link".</p>
      <h1>${escapeHtml(f.title)}</h1>
      ${p("Level", f.level)}${p("Reward (gold)", f.reward)}${p("Location", f.location)}${p("Posted by", f.poster)}
      <h2>Public summary</h2><p>${escapeHtml(f.summary)}</p>
      <h2>Private details</h2>
      ${String(f.details || "").split(/\n/).map((l) => `<p>${escapeHtml(l)}</p>`).join("")}
      <h2>Enemies and Carpathia tiers</h2><p>Enemy | Offense (1-3) | Defense (1-3) | Buffs / notes</p>
      <h2>Outcome notes</h2><p></p>
    </body></html>`;
  }

  async function createDetailsDoc(f) {
    const boundary = "carpathia" + Math.random().toString(36).slice(2);
    const meta = { name: `Bounty details: ${f.title}`, mimeType: "application/vnd.google-apps.document" };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${detailsDocHtml(f)}\r\n--${boundary}--`;
    return api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async function shareWithGms(fileId) {
    const emails = (CFG.GM_EMAILS || []).filter(Boolean);
    const failed = [];
    for (const email of emails) {
      try {
        await api(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "user", role: "reader", emailAddress: email }),
        });
      } catch { failed.push(email); }
    }
    return failed;
  }

  async function appendRow(f, docUrl) {
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).slice(0, 8);
    const row = [id, f.title, f.level, f.reward, "Open", f.poster, f.location, f.summary, docUrl,
      safeUrl(f.image), new Date().toISOString(), CFG.REQUIRE_APPROVAL ? "FALSE" : "TRUE"];
    const range = encodeURIComponent(`${CFG.SHEET_TAB}!A1`);
    return api(`https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const status = $("post-status");
    const submit = $("post-submit");
    const d = new FormData(form);
    const f = {
      title: String(d.get("title")).trim(),
      level: toInt(d.get("level"), 1),
      reward: Math.max(0, toInt(d.get("reward"), 0)),
      location: String(d.get("location") || "").trim(),
      summary: String(d.get("summary")).trim(),
      image: String(d.get("image") || "").trim(),
      details: String(d.get("details") || ""),
      poster: (state.user && (state.user.name || state.user.email)) || "Unknown",
    };
    status.classList.remove("error");
    submit.disabled = true;
    try {
      status.textContent = "Creating your private details doc…";
      const doc = await createDetailsDoc(f);
      let warn = "";
      if (d.get("shareGms")) {
        status.textContent = "Sharing the doc with GMs…";
        const failed = await shareWithGms(doc.id);
        if (failed.length) warn = ` Couldn't share with: ${failed.join(", ")}.`;
      }
      status.textContent = "Adding your bounty to the board…";
      await appendRow(f, doc.webViewLink);
      form.reset();
      $("post-dialog").close();
      notice((CFG.REQUIRE_APPROVAL
        ? "Bounty posted. It will appear on the board once an officer approves it."
        : "Bounty posted.") + warn);
      loadBoard();
    } catch (err) {
      status.classList.add("error");
      status.textContent = `Posting failed: ${err.message}. If your doc was created, it's in your Drive.`;
    } finally {
      submit.disabled = false;
    }
  }

  // ---------- wiring ----------
  function init() {
    const levelSel = document.querySelector('#post-form select[name="level"]');
    levelSel.replaceChildren(...Array.from({ length: 10 }, (_, i) => new Option(String(i + 1))));
    $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
    $("signin").addEventListener("click", () => state.tokenClient && state.tokenClient.requestAccessToken());
    $("signout").addEventListener("click", signOut);
    $("open-post").addEventListener("click", () => { $("post-status").textContent = ""; $("post-dialog").showModal(); });
    $("post-cancel").addEventListener("click", () => $("post-dialog").close());
    $("post-form").addEventListener("submit", onSubmit);
    if (!CFG.GOOGLE_CLIENT_ID) $("signin").hidden = true;
    loadBoard();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
