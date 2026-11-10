/* Unit cards: a systematic card for an NPC or enemy.
 * Layout (1000 x 620): name + title + portrait + level badges on the left,
 * HP and Positive / Negative trait columns on the right, description along the bottom right.
 * render() returns a DOM node; toPngDataUrl() rasterises it with html2canvas. */
(function () {
  "use strict";
  const C = window.CARPATHIA;
  const NS = "http://www.w3.org/2000/svg";

  // Original line icons (no game assets).
  const ICONS = {
    offense: '<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 51 47 13"/><path d="M51 51 17 13"/><path d="M10 44 20 54"/><path d="M54 44 44 54"/><path d="M47 13h6v6"/><path d="M17 13h-6v6"/></g>',
    defense: '<path d="M32 6 54 14v16c0 14-9.5 23.5-22 28C19.5 53.5 10 44 10 30V14z" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/><path d="M32 16v32M20 28h24" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
    healing: '<path d="M32 54S10 41 10 25a11 11 0 0 1 22-3 11 11 0 0 1 22 3c0 16-22 29-22 29z" fill="none" stroke="#fff" stroke-width="4.5" stroke-linejoin="round"/><path d="M32 26v16M24 34h16" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
    buff: '<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 34 32 18l16 16"/><path d="M16 50 32 34l16 16"/><path d="M32 6v6"/></g>',
    portrait: '<g fill="none" stroke="#6b6b70" stroke-width="2.5" stroke-linejoin="round"><path d="M32 8c-9 0-15 8-15 17 0 6 2 10 5 13l-12 6c-3 2-4 5-4 9v3h52v-3c0-4-1-7-4-9l-12-6c3-3 5-7 5-13 0-9-6-17-15-17z"/><path d="M17 25c4-9 26-9 30 0"/></g>',
  };
  const BADGES = {
    offense: { label: "Offense", from: "#2756c9", to: "#0d1f52" },
    defense: { label: "Defense", from: "#9aa3ad", to: "#2f363d" },
    healing: { label: "Healing", from: "#2f9a5c", to: "#0d3a22" },
    buff: { label: "Buff", from: "#c08a1e", to: "#4a2f06" },
  };

  function svg(inner, size) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 64 64");
    s.setAttribute("width", size); s.setAttribute("height", size);
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = inner; // constant, trusted markup from ICONS
    return s;
  }
  function div(cls, text) { const d = document.createElement("div"); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; }
  const safeUrl = (v) => {
    const t = String(v || "").trim();
    if (/^(blob:|data:image\/)/.test(t)) return t; // images the board fetched and inlined for export
    try { const u = new URL(t); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
  };
  const lines = (t) => String(t || "").split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

  function badges(u, kind) {
    const out = [];
    const combat = kind === "enemy" || u.combat;
    if (combat) {
      out.push(["offense", u.offense || "1"], ["defense", u.defense || "1"]);
      if (u.healing) out.push(["healing", u.healingLevel || "1"]);
      if (u.buff) out.push(["buff", u.buffLevel || "1"]);
    }
    return out;
  }

  function traitColumn(title, items, cls) {
    const col = div(`uc-col ${cls}`);
    col.append(div("uc-col-head", title));
    const body = div("uc-col-body");
    if (items.length) {
      const ul = document.createElement("ul");
      items.forEach((t) => {
        const li = document.createElement("li");
        const m = t.match(/^([^:]{1,40}):\s*(.+)$/);
        if (m) { const b = document.createElement("b"); b.textContent = m[1] + ": "; li.append(b, m[2]); } else li.textContent = t;
        ul.append(li);
      });
      body.append(ul);
    } else body.append(div("uc-none", "None"));
    col.append(body);
    return col;
  }

  function render(u, kind) {
    const card = div(`ucard ${kind === "enemy" ? "is-enemy" : "is-npc"}`);
    const pos = lines(u.positive), neg = lines(u.negative);
    const textLen = pos.join("").length + neg.join("").length;
    card.style.setProperty("--trait-size", textLen > 520 ? "12.5px" : textLen > 300 ? "14px" : "16px");

    // Left column
    const left = div("uc-left");
    const nameRow = div("uc-name-row");
    const marker = (C.markers.find((m) => m[0] === u.marker) || ["", ""])[1];
    if (marker) nameRow.append(div("uc-marker", marker));
    nameRow.append(div("uc-name", u.name || "Unnamed"));
    left.append(nameRow);
    left.append(div("uc-title", u.title ? `<${u.title}>` : (kind === "enemy" ? "<Enemy>" : "<NPC>")));
    const frame = div("uc-portrait");
    const src = safeUrl(u.imageUrl);
    if (src) {
      const img = document.createElement("img");
      img.src = src; img.alt = u.name ? `Portrait of ${u.name}` : "Portrait";
      img.referrerPolicy = "no-referrer";
      frame.append(img);
    } else {
      const ph = div("uc-portrait-empty");
      ph.append(svg(ICONS.portrait, 96), div("", "No portrait"));
      frame.append(ph);
    }
    left.append(frame);
    const bl = badges(u, kind);
    const row = div("uc-badges");
    if (bl.length) {
      bl.forEach(([k, lvl]) => {
        const b = div("uc-badge");
        const tile = div("uc-tile");
        tile.style.background = `radial-gradient(circle at 30% 25%, ${BADGES[k].from}, ${BADGES[k].to})`;
        tile.append(svg(ICONS[k], 40));
        const txt = div("uc-badge-text");
        txt.append(div("uc-badge-label", BADGES[k].label), div("uc-badge-level", String(lvl)));
        b.append(tile, txt);
        row.append(b);
      });
    } else row.append(div("uc-noncombat", "Non-combatant"));
    left.append(row);

    // Right column
    const right = div("uc-right");
    const head = div("uc-right-head");
    head.append(div("uc-kind", kind === "enemy" ? "ENEMY" : "NPC"));
    const hp = String(u.hp || "").trim();
    head.append(div("uc-hp", hp ? `HP: ${hp}` : (kind === "enemy" || u.combat ? "HP: –" : "")));
    right.append(head);
    const cols = div("uc-cols");
    cols.append(traitColumn("Positive", pos, "pos"), traitColumn("Negative", neg, "neg"));
    right.append(cols);
    const desc = String(u.description || "").trim();
    if (desc) right.append(div("uc-desc", desc));

    card.append(left, right);
    return card;
  }

  // Returns true if the portrait can be exported (the image host allows cross-origin use).
  function portraitExportable(u) {
    const src = safeUrl(u.imageUrl);
    if (!src) return Promise.resolve(true);
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  async function toPngDataUrl(cardEl) {
    const holder = document.createElement("div");
    holder.className = "uc-offscreen";
    const clone = cardEl.cloneNode(true);
    holder.append(clone);
    document.body.append(holder);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const canvas = await window.html2canvas(clone, { scale: 2, useCORS: true, backgroundColor: "#0b0b0c", logging: false });
      return canvas.toDataURL("image/png");
    } finally { holder.remove(); }
  }

  async function download(u, kind) {
    const ok = await portraitExportable(u);
    const url = await toPngDataUrl(render(u, kind));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(u.name || "unit").replace(/[^\w\- ]+/g, "").trim() || "unit"} - unit card.png`;
    document.body.append(a); a.click(); a.remove();
    return ok;
  }

  window.UnitCard = { render, toPngDataUrl, download, portraitExportable, ICONS };
})();
