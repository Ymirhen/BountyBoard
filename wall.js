/* Bounty wall: the board as a large mahogany wall seen through a window.
 * Rows run from level 10 (top) to level 1 (bottom); each bounty is a notice nailed to its row.
 * Camera: moving the mouse near an edge glides the view that way (the centre is a dead zone so
 * cards don't slide away while you aim), click-drag / touch-drag pans, the wheel scrolls, and the
 * arrow keys pan when the wall has focus. Reduced-motion users get drag/wheel/keys only. */
(function () {
  "use strict";

  const CARD_W = 236, CARD_H = 330, GAP = 56, ROW_H = CARD_H + 70, EMPTY_ROW_H = 74;
  const LEFT = 190, RIGHT = 120, TOP = 90, BOTTOM = 90;
  const EDGE = 0.2;          // outer 20% of the window steers the camera
  const EDGE_SPEED = 900;    // px per second at the very edge
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cam = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, maxX: 0, maxY: 0, raf: 0, last: 0 };
  let viewport, world, hint, onOpen, dragging = null, built = false;

  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  // Stable pseudo-random numbers per bounty so tilt and offset don't change between renders.
  function rand(seed, i) { let h = 2166136261; for (const c of seed + ":" + i) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }
  function koban(level, cls) {
    const row = el("span", `koban-row ${cls || ""}`);
    for (let i = 0; i < 10; i++) row.append(el("i", i < level ? "kb on" : "kb"));
    return row;
  }

  function notice(b) {
    const card = el("button", `bnotice status-${b.status.toLowerCase()}`);
    card.type = "button";
    card.setAttribute("aria-label", `${b.title}, level ${b.level}, ${b.reward} gold, ${b.status}. Open posting.`);
    card.append(el("span", "tack"));
    const inner = el("span", "notice-inner");
    const head = el("span", "notice-head");
    head.append(el("span", "kicker", "BOUNTY"), el("span", `seal ${b.status.toLowerCase()}`, b.status.toUpperCase()));
    inner.append(head);
    if (b.image) {
      const img = el("img", "notice-art"); img.src = b.image; img.alt = ""; img.loading = "lazy"; img.draggable = false;
      img.addEventListener("error", () => img.remove(), { once: true });
      inner.append(img);
    } else inner.append(el("span", "notice-hook", b.hook));
    inner.append(el("span", "notice-title", b.title));
    inner.append(koban(b.level));
    const reward = el("span", "notice-reward");
    reward.append(el("span", "purse", "◈"), `${b.reward.toLocaleString("en-US")} g`);
    inner.append(reward);
    const meta = [b.gm && `GM ${b.gm}`, b.session].filter(Boolean).join(" · ");
    if (meta) inner.append(el("span", "notice-meta", meta));
    card.append(inner);
    card.addEventListener("click", (e) => { if (dragging && dragging.moved) { e.preventDefault(); return; } onOpen(b); });
    card.addEventListener("focus", () => focusOn(card));
    return card;
  }

  function layout(bounties, filter) {
    const rows = [];
    for (let lvl = 10; lvl >= 1; lvl--) rows.push({ lvl, items: bounties.filter((b) => b.level === lvl) });
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
      plaque.append(el("span", "plaque-koban", String(r.lvl)), el("span", "plaque-label", "LEVEL"));
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
    const H = Math.max(vh, y + BOTTOM);
    world.style.width = `${W}px`; world.style.height = `${H}px`;
    cam.maxX = Math.max(0, W - vw); cam.maxY = Math.max(0, H - vh);
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
    window.addEventListener("resize", () => layout(last.bounties, last.filter));
    window.BountyWall._remember = (b, f) => { last = { bounties: b, filter: f }; };
  }

  function render(bounties, filter) {
    window.BountyWall._remember(bounties, filter);
    layout(bounties, filter);
  }

  window.BountyWall = { init, render, koban, _remember() {} };
})();
