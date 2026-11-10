/* Session module PDF: lays a module out like a printed one-shot adventure.
 * The document is built as a flat list of blocks (headings, paragraphs, boxes, unit cards…),
 * flowed onto fixed-size A4 pages here (headings stay with what follows, blocks never split),
 * then each page is rendered with html2canvas and placed into a jsPDF document. */
(function () {
  "use strict";
  const C = window.CARPATHIA;
  const MM = 96 / 25.4;                       // CSS px per mm
  const MARGIN = 12, FOOTER = 14;             // mm
  const PAGE_W = 210, PAGE_H = 297;           // A4, mm
  const INNER_W_MM = PAGE_W - 2 * MARGIN;     // 186 mm
  const INNER_H_MM = PAGE_H - MARGIN - FOOTER; // 271 mm
  const INNER_W = Math.round(INNER_W_MM * MM); // 703 px
  const INNER_H = Math.round(INNER_H_MM * MM); // ~1024 px

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const safeUrl = (v) => { try { const u = new URL(String(v || "").trim()); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };
  const has = (v) => String(v ?? "").trim() !== "";
  const splitParas = (t) => String(t || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  function add(parent, ...kids) { kids.flat().forEach((k) => k && parent.append(k)); return parent; }
  function kv(label, value) {
    if (!has(value)) return null;
    const p = h("p", "pm-kv"); p.append(h("b", "", `${label}: `), String(value)); return p;
  }
  function box(cls, title, text) {
    const b = h("div", cls);
    if (title) b.append(h("div", "pm-box-title", title));
    splitParas(text).forEach((l) => b.append(h("p", "", l)));
    return b;
  }
  function table(title, rows) {
    const wrap = h("div", "pm-table");
    wrap.append(h("div", "pm-table-title", title));
    const t = h("table");
    rows.forEach(([a, b]) => { const tr = h("tr"); tr.append(h("td", "", a), h("td", "", b)); t.append(tr); });
    wrap.append(t);
    return wrap;
  }
  function coins(level) {
    const row = h("div", "pm-coins");
    for (let i = 0; i < 10; i++) row.append(h("span", i < level ? "pm-coin on" : "pm-coin"));
    return row;
  }

  function unitBlock(u, kind) {
    const block = h("div", "pm-unit");
    const wrap = h("div", "ucard-wrap");
    wrap.append(window.UnitCard.render(u, kind));
    block.append(wrap);
    const notes = h("div", "pm-unit-notes");
    if (kind === "npc") add(notes, kv("Motivation", u.motivation), kv("Secret (GM only)", u.secret));
    else add(notes, kv("Tactics (GM only)", u.notes));
    if (notes.childNodes.length) block.append(notes);
    if (kind === "enemy" || u.combat) {
      const o = u.offense || "1", d = u.defense || "1";
      add(block, add(h("div", "pm-tables"),
        table(`Players attack ${u.name || "it"} (Offense ${o})`, C.offense[o]),
        table(`${u.name || "It"} attacks players (Defense ${d})`, C.defense[d])));
    }
    return block;
  }

  // Builds the flat block list: [{ el, keep (stay with next block), breakBefore }]
  function buildBlocks(m) {
    const p = m.public, blocks = [];
    const push = (el, opts = {}) => { if (el) blocks.push({ el, keep: !!opts.keep, breakBefore: !!opts.breakBefore }); };
    const heading = (text, tag = "h2") => push(h(tag, "", text), { keep: true });
    const paras = (text, cls) => splitParas(text).forEach((l) => push(h("p", cls || "", l)));

    // Cover page
    const cover = h("section", "pm-cover");
    add(cover, h("div", "pm-eyebrow", "CARPATHIA SYSTEM · ONE-SHOT SESSION MODULE"), h("h1", "", p.title || "Untitled bounty"));
    add(cover, add(h("div", "pm-cover-meta"), coins(p.level ?? 1), h("div", "pm-level", `Level ${p.level ?? 1}`)));
    const facts = h("div", "pm-facts");
    [["Initial reward", `${p.initialReward ?? 0} gold`], ["Final reward", has(p.finalReward) ? `${p.finalReward} gold` : ""],
      ["Game Master", p.gmName], ["Session", p.session], ["Location", p.location], ["Status", p.status]]
      .filter(([, v]) => has(v))
      .forEach(([k, v]) => facts.append(add(h("div", "pm-fact"), h("div", "pm-fact-k", k), h("div", "pm-fact-v", v))));
    cover.append(facts);
    const art = safeUrl(p.imageUrl);
    if (art) { const img = h("img", "pm-cover-art"); img.src = art; img.alt = ""; img.crossOrigin = "anonymous"; cover.append(img); }
    if (has(p.hook)) cover.append(box("pm-hook", "The posting", p.hook));
    cover.append(h("div", "pm-confidential", "GM ONLY. Do not share this document with players."));
    push(cover);

    const ov = m.overview || {};
    let first = true;
    const section = (title) => { heading(title); if (first) { blocks[blocks.length - 1].breakBefore = true; first = false; } };

    if ([ov.premise, ov.objective, ov.success, ov.failure].some(has)) {
      section("Adventure overview");
      paras(ov.premise);
      const grid = h("div", "pm-two");
      [["Objective", ov.objective], ["Success", ov.success], ["Failure", ov.failure]].filter(([, v]) => has(v))
        .forEach(([k, v]) => grid.append(box("pm-side", k, v)));
      if (grid.childNodes.length) push(grid);
    }
    if (has(m.briefing)) { section("Briefing"); push(box("pm-readaloud", "Read aloud", m.briefing)); }
    if ((m.scenes || []).length) {
      section("Scenes");
      m.scenes.forEach((sc, i) => {
        heading(`Scene ${i + 1}${has(sc.name) ? `: ${sc.name}` : ""}`, "h3");
        if (has(sc.location)) push(h("div", "pm-location", sc.location), { keep: true });
        paras(sc.description);
        if (has(sc.beats)) push(box("pm-side", "Roleplay beats", sc.beats));
        if (has(sc.rolls)) push(box("pm-side pm-rolls", "Rolls and checks", sc.rolls));
      });
    }
    if ((m.npcs || []).length) { section("Cast of characters"); m.npcs.forEach((u) => push(unitBlock(u, "npc"))); }
    if ((m.enemies || []).length) { section("Enemies"); m.enemies.forEach((u) => push(unitBlock(u, "enemy"))); }
    const units = [...(m.npcs || []), ...(m.enemies || [])];
    if (units.some((u) => u.healing || u.buff)) {
      section("Healing and buffing reference");
      const t = h("div", "pm-tables");
      if (units.some((u) => u.healing)) t.append(table("Healing roll", C.healing));
      if (units.some((u) => u.buff)) t.append(table("Buffing roll", C.buffing));
      push(t);
    }
    if (has(m.twists)) { section("Twists and complications"); push(box("pm-side pm-twist", "", m.twists)); }
    const r = m.rewards || {};
    section("Rewards");
    [kv("Initial reward", `${p.initialReward ?? 0} gold`), has(p.finalReward) ? kv("Final reward", `${p.finalReward} gold`) : null,
      kv("Items", r.items), kv("Reputation and other rewards", r.reputation)].forEach((n) => push(n));
    if (has(m.gmNotes)) { section("GM notes"); paras(m.gmNotes); }
    if (m.closed) {
      section(`Outcome: ${m.closed.outcome}`);
      [kv("Closed", String(m.closed.at || "").slice(0, 10)),
        kv("Party", (m.closed.party || []).map((x) => x.player ? `${x.character} (${x.player})` : x.character).join(", ")),
        kv("Gold per merc", m.closed.goldEach)].forEach((n) => push(n));
      paras(m.closed.notes);
    }
    return blocks;
  }

  // Flows blocks onto pages. Returns the page elements (already in the DOM, inside `root`).
  function paginate(blocks, root) {
    const pages = [];
    const newPage = () => { const pg = h("div", "pm-page"); root.append(pg); pages.push(pg); return pg; };
    let page = newPage();
    for (const b of blocks) {
      b.el.dataset.keep = b.keep ? "1" : "";
      if (b.breakBefore && page.childNodes.length) page = newPage();
      page.append(b.el);
      if (page.offsetHeight > INNER_H && page.childNodes.length > 1) {
        const moving = [b.el];
        let prev = b.el.previousElementSibling;
        while (prev && prev.dataset.keep === "1" && prev !== page.firstElementChild) { moving.unshift(prev); prev = prev.previousElementSibling; }
        page = newPage();
        moving.forEach((n) => page.append(n));
      }
    }
    return pages;
  }

  async function waitForImages(root) {
    await Promise.all([...root.querySelectorAll("img")].map((img) => img.complete ? null :
      new Promise((res) => { img.addEventListener("load", res, { once: true }); img.addEventListener("error", res, { once: true }); })));
  }

  async function toBlob(m) {
    const holder = h("div", "pm-offscreen");
    const root = h("div", "pmdoc");
    holder.append(root);
    document.body.append(holder);
    try {
      const pages = paginate(buildBlocks(m), root);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await waitForImages(root);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const title = (m.public && m.public.title) || "Untitled bounty";
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        const height = Math.max(INNER_H, pg.offsetHeight);
        const canvas = await window.html2canvas(pg, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, width: INNER_W, height });
        if (i > 0) pdf.addPage();
        // A page taller than A4 (one oversized block) is scaled down to fit.
        const k = Math.min(1, INNER_H / height);
        const w = INNER_W_MM * k, hmm = (height / MM) * k;
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN + (INNER_W_MM - w) / 2, MARGIN, w, hmm);
        pdf.setFontSize(8); pdf.setTextColor(120, 104, 80);
        pdf.text(`${title} - Carpathia session module`, MARGIN, PAGE_H - 7);
        pdf.text(`${i + 1} / ${pages.length}`, PAGE_W - MARGIN, PAGE_H - 7, { align: "right" });
      }
      return pdf.output("blob");
    } finally { holder.remove(); }
  }

  window.ModulePdf = { buildBlocks, toBlob };
})();
