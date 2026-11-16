// Activity terrain: a contribution heatmap you can drag, flick and hover.
// Port of KokonutUI's Activity Terrain (@dorianbaffier, MIT) to plain Canvas.

(() => {
  "use strict";

  const canvas = document.getElementById("terrain");
  if (!canvas || !canvas.getContext) return;

  const DAYS = 7;
  const GAP = 0.18;
  const MAX_HEIGHT = 4.2;
  const DEG = Math.PI / 180;
  const PITCH_TERRAIN = 56 * DEG;
  const YAW_TERRAIN = 18 * DEG;
  const YAW_LIMIT = 38 * DEG;
  const PITCH_LIMIT = 66 * DEG;
  const DRAG_YAW = 0.32 * DEG;
  const DRAG_PITCH = 0.36 * DEG;
  const SPIN_HALF_LIFE = 0.16;
  const SPIN_IN = (YAW_TERRAIN * Math.LN2) / SPIN_HALF_LIFE;
  const PITCH_STIFFNESS = 140;
  const PITCH_DAMPING = 2 * Math.sqrt(PITCH_STIFFNESS);
  const EDGE_STIFFNESS = 180;
  const BUMP_STIFFNESS = 400;
  const BUMP_DAMPING = 2 * Math.sqrt(BUMP_STIFFNESS) * 0.7;
  const BUMP = 0.45;
  const WAVE = 0.7;
  const PADDING = 28;
  const REST_EPSILON = 0.0005;
  const LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  // A gentle overshoot, so each column pops as it lands.
  function easeOutBack(t) {
    const c = 1.4;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }

  // Resistance past an edge: the further out, the less it moves.
  function rubber(value, min, max) {
    if (value < min) return min - 0.18 * (1 - Math.exp((value - min) / 0.18));
    if (value > max) return max + 0.18 * (1 - Math.exp((max - value) / 0.18));
    return value;
  }

  // Deterministic demo data: busy weekdays, quiet weekends, a few streaks.
  function demoData(weeks) {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const out = [];
    for (let i = 0; i < weeks * DAYS; i++) {
      const weekend = i % DAYS >= 5;
      const season = 0.55 + 0.45 * Math.sin(i / 23);
      const streak = random() > 0.82 ? 2.2 : 1;
      const quiet = random() < (weekend ? 0.55 : 0.12);
      out.push(quiet ? 0 : Math.round((weekend ? 3 : 9) * season * streak * random()));
    }
    return out;
  }

  function parseDay(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function buildCells(data, endDate) {
    const end = parseDay(endDate);
    const start = new Date(end.getTime() - (data.length - 1) * 86400000);
    const offset = (start.getUTCDay() + 6) % 7;
    const max = Math.max(1, ...data);
    return data.map((count, index) => {
      const slot = index + offset;
      const norm = count / max;
      return {
        index,
        col: Math.floor(slot / DAYS),
        row: slot % DAYS,
        count,
        level: count === 0 ? 0 : Math.ceil(norm * 4),
        height: 0.06 + Math.pow(norm, 0.85) * MAX_HEIGHT,
        date: new Date(start.getTime() + index * 86400000),
      };
    });
  }

  function hexToRgb(value) {
    const hex = value.trim().replace("#", "");
    const n = parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shade([r, g, b], amount) {
    const k = 1 - amount;
    return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  }

  function readPalette(node) {
    const style = getComputedStyle(node);
    const read = (name) => style.getPropertyValue(name).trim() || "#888888";
    return {
      levels: [0, 1, 2, 3, 4].map((l) => hexToRgb(read(`--terrain-${l}`))),
      accent: hexToRgb(read("--terrain-accent")),
      text: read("--terrain-text"),
      font: style.fontFamily,
    };
  }

  function project(p, x, y, z) {
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    const xr = x * cos - z * sin;
    const zr = x * sin + z * cos;
    return [
      p.cx + xr * p.scale,
      p.cy + (zr * Math.cos(p.pitch) - y * Math.sin(p.pitch)) * p.scale,
    ];
  }

  // The faces of one column that face the camera, top last.
  function visibleFaces(p, x0, z0, h) {
    const x1 = x0 + 1 - GAP;
    const z1 = z0 + 1 - GAP;
    const pt = (x, y, z) => project(p, x, y, z);
    const faces = [];
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    if (h > 0.02 && p.pitch > 0.01) {
      if (cos > 0) {
        faces.push({ points: [pt(x0, 0, z1), pt(x1, 0, z1), pt(x1, h, z1), pt(x0, h, z1)], tone: 0.22 });
      } else {
        faces.push({ points: [pt(x0, 0, z0), pt(x1, 0, z0), pt(x1, h, z0), pt(x0, h, z0)], tone: 0.22 });
      }
      if (sin > 0.001) {
        faces.push({ points: [pt(x1, 0, z0), pt(x1, 0, z1), pt(x1, h, z1), pt(x1, h, z0)], tone: 0.38 });
      } else if (sin < -0.001) {
        faces.push({ points: [pt(x0, 0, z0), pt(x0, 0, z1), pt(x0, h, z1), pt(x0, h, z0)], tone: 0.38 });
      }
    }
    faces.push({ points: [pt(x0, h, z0), pt(x1, h, z0), pt(x1, h, z1), pt(x0, h, z1)], tone: 0 });
    return faces;
  }

  function inside(points, x, y) {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        hit = !hit;
      }
    }
    return hit;
  }

  function polygon(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
  }

  const formatDay = (date) =>
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const formatMonth = (date) =>
    date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const data = demoData(26);
  const cells = buildCells(data, endDate);
  const weeks = cells[cells.length - 1].col + 1;
  const total = data.reduce((sum, n) => sum + n, 0);

  const readoutEl = document.getElementById("terrain-readout");
  const card = document.getElementById("terrain-card");
  const toggleButtons = Array.from(document.querySelectorAll("[data-view]"));

  const sim = {
    yaw: 0,
    yawSpeed: 0,
    // The intro tilts it up from flat once it's on screen.
    pitch: 0,
    pitchSpeed: 0,
    pitchTarget: PITCH_TERRAIN,
    bumps: new Float64Array(cells.length),
    bumpSpeeds: new Float64Array(cells.length),
    hovered: -1,
    origin: { col: 0, row: 3 },
    width: 0,
    height: 0,
    dpr: 1,
    drag: null,
    raf: 0,
    last: 0,
    visible: false,
    started: false,
    reduceMotion: false,
    palette: null,
  };

  let flat = false;
  let active = null;

  function updateReadout() {
    if (!readoutEl) return;
    readoutEl.textContent = active
      ? `${active.count} ${active.count === 1 ? "contribution" : "contributions"} on ${formatDay(active.date)}`
      : `${total.toLocaleString("en-US")} contributions in the last ${weeks} weeks`;
  }

  // How tall each column stands right now: the rise travels as a wave out
  // from the origin, and each column overshoots a touch as it lands.
  function columnHeight(cell, lift) {
    const span = Math.hypot(weeks, DAYS) || 1;
    const d = Math.hypot(cell.col - sim.origin.col, cell.row - sim.origin.row) / span;
    const local = clamp(lift * (1 + WAVE) - d * WAVE, 0, 1);
    return cell.height * easeOutBack(local) + sim.bumps[cell.index];
  }

  function pose() {
    const lift = clamp(sim.pitch / PITCH_TERRAIN, 0, 1.2);
    // Fit the whole board, at its current turn and tilt, into the canvas.
    const w = weeks;
    const probe = { yaw: sim.yaw, pitch: sim.pitch, scale: 1, cx: 0, cy: 0 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [0, w]) {
      for (const z of [0, DAYS]) {
        for (const y of [0, MAX_HEIGHT * Math.min(lift, 1)]) {
          const [px, py] = project(probe, x - w / 2, y, z - DAYS / 2);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
      }
    }
    // Extra room on the left so the weekday labels don't clip at the edge.
    const padLeft = PADDING + 24;
    const padRight = PADDING;
    const availW = sim.width - padLeft - padRight;
    const availH = sim.height - PADDING * 2;
    const scale = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    return {
      yaw: sim.yaw,
      pitch: sim.pitch,
      scale,
      cx: padLeft + availW / 2 - ((minX + maxX) / 2) * scale,
      cy: sim.height / 2 - ((minY + maxY) / 2) * scale + 6,
      lift,
    };
  }

  // Back to front: the further a column's base, the earlier it's drawn.
  function ordered(p) {
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const depth = (c) =>
      (c.col + 0.5 - weeks / 2) * sin + (c.row + 0.5 - DAYS / 2) * cos;
    return [...cells].sort((a, b) => depth(a) - depth(b));
  }

  function drawLabels(ctx, p, lift, palette) {
    // Labels lie on the ground, so they'd hide behind the columns; they
    // fade out as the terrain rises, and the readout names each day.
    const alpha = clamp(1 - lift * 1.6, 0, 1);
    if (alpha === 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.text;
    ctx.font = `11px ${palette.font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let month = -1;
    for (const cell of cells) {
      if (cell.row !== 0 && cell.index !== 0) continue;
      const m = cell.date.getUTCMonth();
      if (m !== month && cell.col < weeks - 1) {
        month = m;
        const [x, y] = project(p, cell.col - weeks / 2, 0, -0.75 - DAYS / 2);
        ctx.fillText(formatMonth(cell.date), x, y);
      }
    }
    ctx.textAlign = "right";
    for (let row = 0; row < DAYS; row++) {
      if (LABELS[row]) {
        const [x, y] = project(p, -0.35 - weeks / 2, 0, row + 0.4 - DAYS / 2);
        ctx.fillText(LABELS[row], x, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    const ctx = canvas.getContext("2d");
    if (!ctx || !sim.width) return;
    sim.palette ??= readPalette(canvas);
    const palette = sim.palette;
    const p = pose();
    ctx.setTransform(sim.dpr, 0, 0, sim.dpr, 0, 0);
    ctx.clearRect(0, 0, sim.width, sim.height);
    drawLabels(ctx, p, p.lift, palette);
    ctx.lineJoin = "round";
    for (const cell of ordered(p)) {
      const h = columnHeight(cell, p.lift);
      const color = cell.index === sim.hovered ? palette.accent : palette.levels[cell.level];
      for (const face of visibleFaces(p, cell.col - weeks / 2, cell.row - DAYS / 2, h)) {
        polygon(ctx, face.points);
        const fill = shade(color, face.tone);
        ctx.fillStyle = fill;
        ctx.fill();
        // A hairline in the same colour closes the seams between faces.
        ctx.strokeStyle = fill;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }

  function hitTest(x, y) {
    const p = pose();
    const list = ordered(p);
    for (let i = list.length - 1; i >= 0; i--) {
      const cell = list[i];
      const h = columnHeight(cell, p.lift);
      for (const face of visibleFaces(p, cell.col - weeks / 2, cell.row - DAYS / 2, h)) {
        if (inside(face.points, x, y)) return cell;
      }
    }
    return null;
  }

  function stepSprings(dt) {
    let energy = 0;
    if (!sim.drag) {
      // Spin coasts, then the edge pulls it back in range.
      sim.yawSpeed *= 0.5 ** (dt / SPIN_HALF_LIFE);
      let target = sim.yaw;
      if (sim.pitchTarget === 0) {
        // Flat is always square on.
        target = 0;
      } else if (sim.yaw > YAW_LIMIT) {
        target = YAW_LIMIT;
      } else if (sim.yaw < -YAW_LIMIT) {
        target = -YAW_LIMIT;
      }
      if (target !== sim.yaw) {
        sim.yawSpeed +=
          ((target - sim.yaw) * EDGE_STIFFNESS - sim.yawSpeed * 2 * Math.sqrt(EDGE_STIFFNESS)) * dt;
      }
      sim.yaw += sim.yawSpeed * dt;
      energy = Math.max(energy, Math.abs(sim.yawSpeed), Math.abs(target - sim.yaw));

      const force = (sim.pitchTarget - sim.pitch) * PITCH_STIFFNESS - sim.pitchSpeed * PITCH_DAMPING;
      sim.pitchSpeed += force * dt;
      sim.pitch += sim.pitchSpeed * dt;
      energy = Math.max(energy, Math.abs(sim.pitchSpeed), Math.abs(sim.pitchTarget - sim.pitch));
    }
    for (let i = 0; i < sim.bumps.length; i++) {
      const target = i === sim.hovered && sim.pitch > 0.1 ? BUMP : 0;
      sim.bumpSpeeds[i] +=
        ((target - sim.bumps[i]) * BUMP_STIFFNESS - sim.bumpSpeeds[i] * BUMP_DAMPING) * dt;
      sim.bumps[i] += sim.bumpSpeeds[i] * dt;
      energy = Math.max(energy, Math.abs(sim.bumpSpeeds[i]) * 0.1, Math.abs(target - sim.bumps[i]));
    }
    return energy;
  }

  function tick(nowMs) {
    sim.raf = 0;
    const dt = sim.last ? Math.min((nowMs - sim.last) / 1000, 1 / 30) : 1 / 60;
    sim.last = nowMs;
    const energy = stepSprings(dt);
    draw();
    if ((sim.drag || energy > REST_EPSILON) && sim.visible) {
      sim.raf = requestAnimationFrame(tick);
    } else {
      sim.last = 0;
    }
  }

  // Swing round from straight on as it tilts up, coasting to a stop at
  // the resting turn.
  function turnIn() {
    if (Math.abs(sim.yaw) > 2 * DEG) return;
    if (sim.reduceMotion) {
      sim.yaw = YAW_TERRAIN;
    } else {
      sim.yawSpeed = SPIN_IN;
    }
  }

  function wake() {
    if (sim.reduceMotion) {
      // No travel: everything lands where it's going.
      sim.pitch = sim.pitchTarget;
      sim.yaw = clamp(sim.yaw, -YAW_LIMIT, YAW_LIMIT);
      sim.pitchSpeed = 0;
      sim.yawSpeed = 0;
      sim.bumps.fill(0);
      draw();
      return;
    }
    if (!sim.raf && sim.visible) {
      sim.raf = requestAnimationFrame(tick);
    }
  }

  function syncToggle() {
    for (const btn of toggleButtons) {
      btn.setAttribute("aria-pressed", String((btn.dataset.view === "flat") === flat));
    }
  }

  function setView(nextFlat, origin) {
    flat = nextFlat;
    syncToggle();
    sim.origin = origin ?? { col: nextFlat ? weeks : 0, row: 3 };
    sim.pitchTarget = nextFlat ? 0 : PITCH_TERRAIN;
    sim.yawSpeed = 0;
    if (!nextFlat) turnIn();
    wake();
  }

  function land(nextFlat) {
    flat = nextFlat;
    syncToggle();
    sim.pitchTarget = nextFlat ? 0 : PITCH_TERRAIN;
  }

  function hover(cell) {
    const index = cell ? cell.index : -1;
    if (index === sim.hovered) return;
    sim.hovered = index;
    active = cell;
    updateReadout();
    if (sim.reduceMotion) {
      draw();
    } else {
      wake();
    }
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  for (const btn of toggleButtons) {
    btn.addEventListener("click", () => {
      const wantFlat = btn.dataset.view === "flat";
      if (flat === wantFlat) return;
      setView(wantFlat);
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const { x, y } = localPoint(event);
    canvas.setPointerCapture(event.pointerId);
    const cell = hitTest(x, y);
    if (cell) sim.origin = { col: cell.col, row: cell.row };
    sim.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: sim.yaw,
      pitch: sim.pitch,
      moved: false,
      samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
    };
    sim.yawSpeed = 0;
    sim.pitchSpeed = 0;
    card.classList.add("is-dragging");
    hover(cell);
    wake();
  });

  canvas.addEventListener("pointermove", (event) => {
    const drag = sim.drag;
    if (!drag || drag.id !== event.pointerId) {
      if (event.pointerType === "mouse") {
        const { x, y } = localPoint(event);
        hover(hitTest(x, y));
      }
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    sim.yaw = rubber(drag.yaw + dx * DRAG_YAW, -YAW_LIMIT, YAW_LIMIT);
    sim.pitch = rubber(drag.pitch + dy * DRAG_PITCH, 0, PITCH_LIMIT);
    drag.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (drag.samples.length > 5) drag.samples.shift();
    if (sim.reduceMotion) {
      draw();
    } else {
      wake();
    }
  });

  function endDrag(event) {
    const drag = sim.drag;
    if (!drag || drag.id !== event.pointerId) return;
    sim.drag = null;
    card.classList.remove("is-dragging");
    if (!drag.moved) {
      wake();
      return;
    }
    // Velocity from the last few samples, in px per second.
    const first = drag.samples[0];
    const lastSample = drag.samples[drag.samples.length - 1] ?? first;
    const dt = Math.max((lastSample.t - first.t) / 1000, 0.016);
    const vx = (lastSample.x - first.x) / dt;
    const vy = (lastSample.y - first.y) / dt;
    const recent = event.timeStamp - lastSample.t < 80;
    sim.yawSpeed = recent ? vx * DRAG_YAW : 0;
    sim.pitchSpeed = recent ? vy * DRAG_PITCH : 0;
    // Land on whichever view the throw is heading for.
    const projected = sim.pitch + sim.pitchSpeed * 0.15;
    const nextFlat = projected < PITCH_TERRAIN / 2;
    land(nextFlat);
    wake();
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);

  canvas.addEventListener("pointerleave", (event) => {
    if (!sim.drag && event.pointerType === "mouse") hover(null);
  });

  canvas.addEventListener("blur", () => {
    // Keyboard reading ends with focus; don't leave a day lit.
    if (!sim.drag) hover(null);
  });

  canvas.addEventListener("keydown", (event) => {
    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const current = cells[sim.hovered] ?? cells[cells.length - 1];
    if (!current) return;
    const col = current.col + move[0];
    const row = current.row + move[1];
    const next = cells.find((c) => c.col === col && c.row === row);
    hover(next ?? current);
  });

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  sim.reduceMotion = motion.matches;
  motion.addEventListener("change", (event) => {
    sim.reduceMotion = event.matches;
    if (event.matches) wake();
  });

  const resize = new ResizeObserver(([entry]) => {
    sim.width = entry.contentRect.width;
    sim.height = entry.contentRect.height;
    sim.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(sim.width * sim.dpr);
    canvas.height = Math.round(sim.height * sim.dpr);
    draw();
  });
  resize.observe(canvas);

  let onScreen = false;
  function update() {
    sim.visible = onScreen && !document.hidden;
    if (sim.visible) {
      if (!sim.started) {
        sim.started = true;
        if (sim.pitchTarget > 0) turnIn();
      }
      wake();
    } else if (sim.raf) {
      cancelAnimationFrame(sim.raf);
      sim.raf = 0;
      sim.last = 0;
    }
  }

  const intersection = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    update();
  });
  intersection.observe(canvas);
  document.addEventListener("visibilitychange", update);

  updateReadout();
  syncToggle();
})();
