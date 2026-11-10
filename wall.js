/* Bounty wall: the board as a large mahogany wall seen through a window.
 * Two arrangements:
 *   scatter (default): notices nailed up at seeded random spots and angles, like a tavern board;
 *     newer notices overlap older ones, and torn scraps and nail holes fill the gaps.
 *   levels: rows from level 10 (top) to level 0 (bottom), each notice nailed to its row.
 * Camera: moving the mouse near an edge glides the view that way (the centre is a dead zone so
 * cards don't slide away while you aim), click-drag / touch-drag pans, the wheel scrolls, and the
 * arrow keys pan when the wall has focus. Reduced-motion users get drag/wheel/keys only. */
(function () {
  "use strict";

  const CARD_W = 236, CARD_H = 350, POSTER_MAX_H = 380, GAP = 56, ROW_H = CARD_H + 70, EMPTY_ROW_H = 74;
  const LEFT = 190, RIGHT = 120, TOP = 90, BOTTOM = 90;
  const EDGE = 0.2;          // outer 20% of the window steers the camera
  const EDGE_SPEED = 900;    // px per second at the very edge
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cam = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, maxX: 0, maxY: 0, raf: 0, last: 0 };
  let viewport, world, hint, onOpen, dragging = null, built = false, mode = "scatter", centeredFor = "";

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  // Stable pseudo-random numbers per bounty so tilt and offset don't change between renders.
  function rand(seed, i) { let h = 2166136261; for (const c of seed + ":" + i) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }
  function koban(level, cls) {
    const row = el("span", `koban-row ${cls || ""}`);
    for (let i = 0; i < 10; i++) row.append(el("i", i < level ? "kb on" : "kb"));
    return row;
  }

  // Worn paper: a ragged outline with a few tears, scorched edges, a fold crease, stains and
  // sometimes a dog-eared corner. Everything is seeded from the bounty id so it never changes.
  function wornPaper(id, w, h) {
    const r = (i) => rand(id, 100 + i);
    let k = 0;
    const pts = [];
    const tears = [Math.floor(r(k++) * 4), Math.floor(r(k++) * 4)]; // which sides get a tear
    const tearAt = [0.2 + r(k++) * 0.6, 0.2 + r(k++) * 0.6];
    const dogEar = r(k++) < 0.45 ? Math.floor(r(k++) * 4) : -1;     // 0 TL, 1 TR, 2 BR, 3 BL
    const EAR = 22;
    const jag = () => 0.6 + r(k++) * 3.6;
    // walk the four sides clockwise; side s goes from corner s to corner s+1
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    const inward = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    const EDGE_IN = 1.8; // where the fold meets the torn edge
    const foldPt = (c, along) => { // point on the edge, EAR away from corner c, along side direction
      const [cx, cy] = corners[c];
      return along === "x" ? [cx + (c === 0 || c === 3 ? EAR : -EAR), cy + (c < 2 ? EDGE_IN : -EDGE_IN)]
                           : [cx + (c === 0 || c === 3 ? EDGE_IN : -EDGE_IN), cy + (c < 2 ? EAR : -EAR)];
    };
    let ear = null;
    for (let s = 0; s < 4; s++) {
      const [x0, y0] = corners[s], [x1, y1] = corners[(s + 1) % 4], [nx, ny] = inward[s];
      const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.round(len / 11);
      const horizontal = s === 0 || s === 2;
      if (s === dogEar) pts.push(foldPt(s, horizontal ? "x" : "y"));        // fold starts this side
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (s === dogEar && t * len < EAR + 3) continue;
        if ((s + 1) % 4 === dogEar && (1 - t) * len < EAR + 3) continue;
        let d = jag();
        tears.forEach((side, j) => {
          if (side !== s) return;
          const dist = Math.abs(t - tearAt[j]) * len;
          if (dist < 6) d += (6 - dist) * 2.1; // a small V-shaped nick
        });
        pts.push([x0 + (x1 - x0) * t + nx * d, y0 + (y1 - y0) * t + ny * d]);
      }
      if ((s + 1) % 4 === dogEar) pts.push(foldPt((s + 1) % 4, horizontal ? "x" : "y")); // fold ends on the next side
    }
    if (dogEar >= 0) {
      // The two fold points A and B; the flap tip is the corner mirrored across AB.
      const c = corners[dogEar];
      const A = foldPt(dogEar, "x"), B = foldPt(dogEar, "y");
      const tip = [A[0] + B[0] - c[0], A[1] + B[1] - c[1]];
      ear = { corner: dogEar, A, B, tip };
    }
    const clip = `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",")})`;
    // stains and a crease, as CSS background layers on top of the parchment texture
    const stains = [0, 1, 2].map(() => {
      const x = Math.round(r(k++) * 100), y = Math.round(r(k++) * 100), sz = 30 + Math.round(r(k++) * 60), a = (0.05 + r(k++) * 0.09).toFixed(2);
      return `radial-gradient(${sz}px ${Math.round(sz * (0.6 + r(k++) * 0.6))}px at ${x}% ${y}%, rgba(120,72,20,${a}), rgba(120,72,20,${(a * 0.4).toFixed(2)}) 55%, transparent 72%)`;
    });
    const creaseAngle = r(k++) < 0.5 ? 0 : 90, creasePos = 38 + Math.round(r(k++) * 24);
    const crease = `linear-gradient(${creaseAngle}deg, transparent ${creasePos - 0.6}%, rgba(90,60,25,.16) ${creasePos}%, rgba(255,250,235,.28) ${creasePos + 0.5}%, transparent ${creasePos + 1.2}%)`;
    return { clip, layers: [crease, ...stains].join(","), ear };
  }

  // Wax seal with its status written beside it (the seal art itself carries no text).
  function seal(status) {
    const s = el("span", `seal-badge ${status.toLowerCase()}`);
    const img = el("img"); img.src = `assets/seal-${status.toLowerCase()}.png`; img.alt = ""; img.draggable = false;
    s.append(img, el("span", "seal-text", status.toUpperCase()));
    return s;
  }

  // Flap = triangle A, B, tip, drawn in its own small box so the shading gradient fits it.
  function dogEar(e) {
    if (!e) return null;
    const { A, B, tip, corner } = e;
    const xs = [A[0], B[0], tip[0]], ys = [A[1], B[1], tip[1]];
    const left = Math.min(...xs), top = Math.min(...ys);
    const box = el("span", `dog-ear c${corner}`);
    box.style.left = `${left}px`; box.style.top = `${top}px`;
    box.style.width = `${Math.max(...xs) - left}px`; box.style.height = `${Math.max(...ys) - top}px`;
    const flap = el("span", "flap");
    flap.style.clipPath = `polygon(${[A, B, tip].map(([x, y]) => `${(x - left).toFixed(1)}px ${(y - top).toFixed(1)}px`).join(",")})`;
    box.append(flap);
    return box;
  }

  function notice(b) {
    const card = el("button", `bnotice status-${b.status.toLowerCase()}`);
    card.type = "button";
    card.setAttribute("aria-label", `${b.title}, level ${b.level}, ${b.reward} gold, ${b.status}. Open posting.`);
    const tack = el("img", "tack"); tack.src = "assets/tack.png"; tack.alt = ""; tack.draggable = false; card.append(tack);
    const worn = wornPaper(b.id, CARD_W, CARD_H);
    const paper = el("span", "paper");
    paper.style.clipPath = worn.clip;
    paper.style.setProperty("--wear", worn.layers);
    card.append(paper);
    const ear = dogEar(worn.ear);
    if (ear) card.append(ear);
    const inner = el("span", "notice-inner");
    const head = el("span", "notice-head");
    head.append(el("span", "kicker", "BOUNTY"), seal(b.status));
    inner.append(head);
    inner.append(el("span", "notice-hook", b.hook));
    inner.append(el("span", "notice-title", b.title));
    inner.append(koban(b.level));
    const reward = el("span", "notice-reward");
    const purse = el("img", "purse"); purse.src = "assets/purse.png"; purse.alt = ""; purse.draggable = false;
    reward.append(purse, `${b.reward.toLocaleString("en-US")} g`);
    inner.append(reward);
    const meta = [b.gm && `GM ${b.gm}`, b.session].filter(Boolean).join(" · ");
    if (meta) inner.append(el("span", "notice-meta", meta));
    paper.append(inner); // inside the paper, so the torn outline trims it too
    // With poster art the wall shows only the poster itself, tacked up. The parchment notice
    // above stays in the DOM (hidden) and comes back if the image fails to load.
    if (b.image) {
      const frame = el("span", "poster");
      const poster = el("img", "poster-art"); poster.alt = ""; poster.draggable = false; poster.loading = "lazy";
      frame.append(poster, el("span", "poster-wear"));
      card.classList.add("poster-only");
      card.append(frame);
      poster.addEventListener("error", () => { card.classList.remove("poster-only"); frame.remove(); }, { once: true });
      poster.addEventListener("load", () => {
        // Same torn edges, scorch, crease, stains and dog-ear as the parchment, sized to this poster.
        const h = Math.round(Math.min(POSTER_MAX_H, CARD_W * poster.naturalHeight / Math.max(1, poster.naturalWidth)));
        frame.style.height = `${h}px`;
        const pw = wornPaper(b.id + ":poster", CARD_W, h);
        frame.style.clipPath = pw.clip;
        frame.style.setProperty("--wear", pw.layers);
        const ear = dogEar(pw.ear);
        if (ear) card.append(ear);
      }, { once: true });
      poster.src = b.image;
    }
    card.addEventListener("click", (e) => { if (dragging && dragging.moved) { e.preventDefault(); return; } onOpen(b); });
    card.addEventListener("focus", () => focusOn(card));
    return card;
  }

  function layout(bounties, filter) {
    if (!viewport.clientWidth) return; // hidden: the ResizeObserver lays out once it's shown
    world.classList.toggle("scatter", mode === "scatter");
    if (mode === "scatter") layoutScatter(bounties, filter); else layoutLevels(bounties, filter);
  }

  // ---------- scatter ----------
  // Board area grows with the number of notices. Each notice (oldest first) tries 60 seeded spots
  // and takes the one it overlaps least, with a slight pull toward the middle so small boards look
  // full rather than sparse. Newer notices are pinned on top. All randomness is seeded per bounty,
  // so a notice keeps its spot between visits.
  function layoutScatter(bounties, filter) {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const n = bounties.length, M = 60;
    const cell = (CARD_W + 40) * (CARD_H + 40);
    const aspect = Math.max(1.3, vw / vh);
    const area = Math.max(vw * vh, n * cell * 1.7);
    const W = Math.max(vw, Math.round(Math.sqrt(area * aspect)));
    const H = Math.max(vh, Math.round(area / W), CARD_H + 2 * M + 40);
    world.replaceChildren();
    const order = bounties.slice().sort((a, b) => String(a.created).localeCompare(String(b.created)) || a.id.localeCompare(b.id));
    const placed = [];
    const overlap = (r) => placed.reduce((sum, q) => {
      const x = Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x));
      const y = Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y));
      return sum + x * y;
    }, 0);
    order.forEach((b, i) => {
      const s = 0.94 + b.level * 0.012;             // higher bounties are posted a little larger
      const w = CARD_W * s, h = CARD_H * s;
      let best = null;
      for (let k = 0; k < 80; k++) {
        const r = { x: M + rand(b.id, 10 + k) * Math.max(1, W - 2 * M - w), y: M + 14 + rand(b.id, 120 + k) * Math.max(1, H - 2 * M - h - 14), w, h };
        const centre = Math.hypot((r.x + w / 2) / W - 0.5, (r.y + h / 2) / H - 0.5);
        const f = overlap(r) / (w * h);
        const score = f * f * 4 + f + centre * 0.05; // overlap matters most; big overlaps far more than small
        if (!best || score < best.score) best = { ...r, score };
      }
      placed.push(best);
      const node = notice(b);
      node.style.left = `${best.x}px`; node.style.top = `${best.y}px`;
      node.style.zIndex = String(10 + i);
      node.style.setProperty("--tilt", `${((rand(b.id, 3) - 0.5) * 13).toFixed(2)}deg`);
      node.style.setProperty("--s", s.toFixed(3));
      if (filter !== "All" && b.status !== filter) node.classList.add("dimmed");
      world.append(node);
    });
    // Atmosphere: torn leftovers of old notices and empty nail holes, placed where they cover least.
    const seed = "board";
    const extras = Math.round(n * 0.7) + 5;
    for (let j = 0; j < extras; j++) {
      const w = 50 + rand(seed, 200 + j) * 80, h = 34 + rand(seed, 300 + j) * 60;
      let best = null;
      for (let k = 0; k < 25; k++) {
        const r = { x: 20 + rand(seed, 1000 + j * 31 + k) * (W - 40 - w), y: 20 + rand(seed, 5000 + j * 31 + k) * (H - 40 - h), w, h };
        const o = overlap(r);
        if (!best || o < best.o) best = { ...r, o };
      }
      if (best.o > w * h * 0.15) continue;
      const scrap = el("span", "scrap");
      scrap.setAttribute("aria-hidden", "true");
      scrap.style.left = `${best.x}px`; scrap.style.top = `${best.y}px`;
      scrap.style.width = `${w}px`; scrap.style.height = `${h}px`;
      scrap.style.setProperty("--tilt", `${((rand(seed, 400 + j) - 0.5) * 30).toFixed(1)}deg`);
      scrap.style.clipPath = wornPaper(`scrap${j}`, w, h).clip;
      if (rand(seed, 600 + j) < 0.6) { const t = el("img", "scrap-tack"); t.src = "assets/tack.png"; t.alt = ""; t.draggable = false; scrap.append(t); }
      world.append(scrap);
      const hole = el("span", "nail-hole");
      hole.setAttribute("aria-hidden", "true");
      hole.style.left = `${20 + rand(seed, 700 + j) * (W - 40)}px`; hole.style.top = `${20 + rand(seed, 800 + j) * (H - 40)}px`;
      world.append(hole);
    }
    if (!n) world.append(el("div", "wall-empty", "No bounties on the board right now."));
    finishLayout(W, H, vw, vh);
  }

  // ---------- rows by level ----------
  function layoutLevels(bounties, filter) {
    const rows = [];
    for (let lvl = 10; lvl >= 0; lvl--) rows.push({ lvl, items: bounties.filter((b) => b.level === lvl) });
    const widest = Math.max(1, ...rows.map((r) => r.items.length));
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const W = Math.max(vw, LEFT + widest * (CARD_W + GAP) - GAP + RIGHT);
    let y = TOP;
    world.replaceChildren();
    for (const r of rows) {
      const h = r.items.length ? ROW_H : EMPTY_ROW_H;
      const row = el("div", r.items.length ? "wall-row" : "wall-row empty");
      row.style.top = `${y}px`; row.style.height = `${h}px`; row.style.width = `${W}px`;
      const plaque = el("div", "level-plaque");
      const kob = el("img", "plaque-koban"); kob.src = "assets/coin-gold.png"; kob.alt = ""; kob.draggable = false;
      const num = el("span", "plaque-num"); num.append(el("span", "plaque-level", String(r.lvl)), el("span", "plaque-label", "LEVEL"));
      plaque.append(kob, num);
      row.append(plaque, el("div", "row-rail"));
      r.items.forEach((b, i) => {
        const n = notice(b);
        const dx = (rand(b.id, 1) - 0.5) * 24, dy = (rand(b.id, 2) - 0.5) * 22, rot = (rand(b.id, 3) - 0.5) * 5;
        n.style.left = `${LEFT + i * (CARD_W + GAP) + dx}px`;
        n.style.top = `${30 + dy}px`;
        n.style.setProperty("--tilt", `${rot.toFixed(2)}deg`);
        if (filter !== "All" && b.status !== filter) n.classList.add("dimmed");
        row.append(n);
      });
      world.append(row);
      y += h;
    }
    if (!bounties.length) world.append(el("div", "wall-empty", "No bounties on the board right now."));
    finishLayout(W, Math.max(vh, y + BOTTOM), vw, vh);
  }

  function finishLayout(W, H, vw, vh) {
    world.style.width = `${W}px`; world.style.height = `${H}px`;
    cam.maxX = Math.max(0, W - vw); cam.maxY = Math.max(0, H - vh);
    // Start a scattered board in the middle; start the level rows at the top.
    if (centeredFor !== mode) {
      centeredFor = mode;
      cam.tx = mode === "scatter" ? cam.maxX / 2 : 0;
      cam.ty = mode === "scatter" ? cam.maxY / 2 : 0;
    }
    clamp(); apply(true);
    viewport.classList.toggle("pannable", cam.maxX > 0 || cam.maxY > 0);
  }

  function clamp() {
    cam.tx = Math.min(cam.maxX, Math.max(0, cam.tx));
    cam.ty = Math.min(cam.maxY, Math.max(0, cam.ty));
  }
  function apply(snap) {
    if (snap) { cam.x = cam.tx; cam.y = cam.ty; }
    world.style.transform = `translate3d(${-cam.x}px, ${-cam.y}px, 0)`;
  }
  function tick(t) {
    const dt = Math.min(0.05, (t - (cam.last || t)) / 1000); cam.last = t;
    if (!dragging) { cam.tx += cam.vx * dt; cam.ty += cam.vy * dt; clamp(); }
    const k = dragging ? 1 : 1 - Math.pow(0.0015, dt); // smooth follow
    cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k;
    apply(false);
    const moving = Math.abs(cam.tx - cam.x) > 0.3 || Math.abs(cam.ty - cam.y) > 0.3 || cam.vx || cam.vy || dragging;
    cam.raf = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) cam.last = 0;
  }
  function wake() { if (!cam.raf) cam.raf = requestAnimationFrame(tick); }

  function edgeVelocity(pos, size) {
    const zone = size * EDGE;
    if (pos < zone) return -EDGE_SPEED * Math.pow(1 - pos / zone, 1.6);
    if (pos > size - zone) return EDGE_SPEED * Math.pow(1 - (size - pos) / zone, 1.6);
    return 0;
  }
  function onMove(e) {
    if (e.pointerType !== "mouse") return;
    const r = viewport.getBoundingClientRect();
    if (dragging) return;
    if (reduceMotion) return;
    cam.vx = cam.maxX ? edgeVelocity(e.clientX - r.left, r.width) : 0;
    cam.vy = cam.maxY ? edgeVelocity(e.clientY - r.top, r.height) : 0;
    if (cam.vx || cam.vy) { hideHint(); wake(); }
  }
  function stopEdge() { cam.vx = cam.vy = 0; }

  function onDown(e) {
    if (e.button !== 0) return;
    dragging = { x: e.clientX, y: e.clientY, cx: cam.tx, cy: cam.ty, moved: false, id: e.pointerId };
    stopEdge();
  }
  function onDrag(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    if (!dragging.moved && Math.hypot(dx, dy) > 6) {
      dragging.moved = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add("grabbing"); hideHint();
    }
    if (dragging.moved) { cam.tx = dragging.cx - dx; cam.ty = dragging.cy - dy; clamp(); wake(); }
  }
  function onUp(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    viewport.classList.remove("grabbing");
    const was = dragging;
    setTimeout(() => { if (dragging === was) dragging = null; }, 0); // let the click handler see `moved`
  }
  function onWheel(e) {
    if (!cam.maxX && !cam.maxY) return;
    const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
    const atTop = cam.ty <= 0 && dy < 0, atBottom = cam.ty >= cam.maxY && dy > 0;
    if ((atTop || atBottom) && !dx) return; // let the page scroll past the wall
    e.preventDefault();
    cam.tx += dx; cam.ty += dy; clamp(); hideHint(); wake();
  }
  function onKey(e) {
    if (e.target !== viewport) return;
    const step = e.shiftKey ? 400 : 120;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!map[e.key]) return;
    e.preventDefault();
    cam.tx += map[e.key][0]; cam.ty += map[e.key][1]; clamp(); wake();
  }
  function focusOn(card) {
    const vr = viewport.getBoundingClientRect(), cr = card.getBoundingClientRect();
    cam.tx += (cr.left + cr.width / 2) - (vr.left + vr.width / 2);
    cam.ty += (cr.top + cr.height / 2) - (vr.top + vr.height / 2);
    clamp(); wake();
  }
  function hideHint() { if (hint) hint.classList.add("gone"); }

  function init(opts) {
    if (built) return;
    built = true;
    viewport = opts.viewport; world = opts.world; hint = opts.hint; onOpen = opts.onOpen;
    viewport.addEventListener("pointermove", (e) => { onDrag(e); onMove(e); });
    viewport.addEventListener("pointerleave", stopEdge);
    viewport.addEventListener("pointerdown", onDown);
    viewport.addEventListener("pointerup", onUp);
    viewport.addEventListener("pointercancel", onUp);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("keydown", onKey);
    viewport.addEventListener("dragstart", (e) => e.preventDefault());
    let last = { bounties: [], filter: "All" };
    // Re-lay out whenever the window changes size, including when the wall becomes visible again.
    let lastSize = "";
    new ResizeObserver(() => {
      if (!viewport.clientWidth) { lastSize = ""; return; } // hidden: lay out again when shown
      const size = `${viewport.clientWidth}x${viewport.clientHeight}`;
      if (size !== lastSize) { lastSize = size; layout(last.bounties, last.filter); }
    }).observe(viewport);
    window.BountyWall._remember = (b, f) => { last = { bounties: b, filter: f }; };
  }

  function render(bounties, filter, arrangement) {
    mode = arrangement === "levels" ? "levels" : "scatter";
    window.BountyWall._remember(bounties, filter);
    layout(bounties, filter);
  }

  window.BountyWall = { init, render, koban, seal, _remember() {} };
})();
