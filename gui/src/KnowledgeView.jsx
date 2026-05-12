import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ENTITY_KIND_COLORS,
  predicateColor, predicateGroupName,
} from "./constants.js";

function CtrlBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 26, height: 26, border: "none", background: "transparent",
      color: "#aaa", fontSize: 14, cursor: "pointer", borderRadius: 4,
      transition: "background 0.12s",
    }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
       onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >{children}</button>
  );
}

function Minimap({ nodes, nodePos, viewport, transform, colorFor }) {
  const W = 130, H = 90;
  // bounds in pixel space
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const p = nodePos.get(n.id); if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  if (!isFinite(minX)) return null;
  const pad = 20;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const sx = W / (maxX - minX), sy = H / (maxY - minY);
  const s = Math.min(sx, sy);
  // viewport rectangle (where main view is looking, in source-space)
  const vw = viewport.w / transform.k;
  const vh = viewport.h / transform.k;
  const vx = -transform.x / transform.k + viewport.w / 2 - vw / 2;
  const vy = -transform.y / transform.k + viewport.h / 2 - vh / 2;

  return (
    <div style={{
      position: "absolute", right: 16, bottom: 16,
      width: W, height: H,
      background: "rgba(10,10,20,0.85)", backdropFilter: "blur(10px)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 8, overflow: "hidden",
      pointerEvents: "none",
    }}>
      <svg width={W} height={H}>
        {nodes.map(n => {
          const p = nodePos.get(n.id); if (!p) return null;
          return (
            <circle key={n.id}
              cx={(p.x - minX) * s}
              cy={(p.y - minY) * s}
              r={1.4}
              fill={colorFor(n)}
              opacity={0.85}
            />
          );
        })}
        {/* viewport indicator */}
        <rect
          x={(vx - minX) * s}
          y={(vy - minY) * s}
          width={vw * s}
          height={vh * s}
          fill="none"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

export function KnowledgeView({
  data, hoverId, setHoverId, kindFilter, predicateFilter, searchMatches,
  onSelect, selectedEntityId,
}) {
  const wrapRef  = useRef(null);
  const simRef   = useRef(new Map());
  const edgesRef = useRef(data.edges);
  const [viewport, setViewport] = useState({ w: 1000, h: 800 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [time, setTime] = useState(0);
  const dragRef = useRef(null);

  // viewport
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // sim sync
  useEffect(() => {
    const next = new Map();
    for (const n of data.nodes) {
      const ex = simRef.current.get(n.id);
      if (ex) next.set(n.id, ex);
      else {
        const angle = Math.random() * Math.PI * 2;
        next.set(n.id, { x: Math.cos(angle) * 0.4, y: Math.sin(angle) * 0.4, vx: 0, vy: 0 });
      }
    }
    simRef.current = next;
    edgesRef.current = data.edges;
  }, [data]);

  // wheel zoom (non-passive)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top  - rect.height / 2;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setTransform(t => {
        const newK = Math.min(8, Math.max(0.3, t.k * factor));
        const dk = newK / t.k;
        return { k: newK, x: mx - (mx - t.x) * dk, y: my - (my - t.y) * dk };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // pan
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current; if (!d) return;
      setTransform(t => ({ ...t, x: d.tx + (e.clientX - d.startX), y: d.ty + (e.clientY - d.startY) }));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // sim loop (mount-once)
  useEffect(() => {
    let raf;
    let last = performance.now();
    const start = last;
    const REPEL    = 0.030,   // pairwise inverse-square strength
          MIN_D2   = 0.006,   // distance² floor — prevents force explosion when nodes overlap
          MAX_F    = 1.2,     // per-pair force cap
          SPRING   = 1.5,
          IDEAL    = 0.22,
          DAMP     = 0.82,
          GRAVITY  = 0.18,
          MAX_V    = 1.0,
          SIM_K    = 5,
          KIND_PULL = 0.008;
    const kindAnchor = (k) => {
      const kinds = Object.keys(ENTITY_KIND_COLORS);
      const idx = kinds.indexOf(k);
      if (idx < 0) return { ax: 0, ay: 0 };
      const angle = (idx / kinds.length) * Math.PI * 2;
      return { ax: Math.cos(angle) * 0.65, ay: Math.sin(angle) * 0.65 };
    };
    const kindById = new Map();
    data.nodes.forEach(n => kindById.set(n.id, n.kind || "other"));

    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const m = simRef.current;
      const arr = [...m.values()];
      const ids = [...m.keys()];
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          // floor distance² so coincident nodes don't blow up
          if (d2 < MIN_D2) {
            // also nudge if exactly coincident
            if (d2 < 1e-6) { dx = (Math.random() - 0.5) * 0.05; dy = (Math.random() - 0.5) * 0.05; }
            d2 = MIN_D2;
          }
          const d = Math.sqrt(d2);
          let f = REPEL / d2;
          if (f > MAX_F) f = MAX_F;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      for (const e of edgesRef.current) {
        const a = m.get(e.src), b = m.get(e.dst);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const force = (d - IDEAL) * SPRING * (e.weight || 0.5);
        const fx = (dx / d) * force, fy = (dy / d) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      for (let i = 0; i < arr.length; i++) {
        const n = arr[i];
        const k = kindById.get(ids[i]);
        const a = kindAnchor(k);
        n.vx += -n.x * GRAVITY * dt;
        n.vy += -n.y * GRAVITY * dt;
        n.vx += (a.ax - n.x) * KIND_PULL * dt * 60;
        n.vy += (a.ay - n.y) * KIND_PULL * dt * 60;
        n.vx *= DAMP; n.vy *= DAMP;
        if (n.vx >  MAX_V) n.vx =  MAX_V;
        if (n.vx < -MAX_V) n.vx = -MAX_V;
        if (n.vy >  MAX_V) n.vy =  MAX_V;
        if (n.vy < -MAX_V) n.vy = -MAX_V;
        n.x += n.vx * dt * SIM_K;
        n.y += n.vy * dt * SIM_K;
      }
      setTime((now - start) / 1000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // positions — scale so graph fills the viewport more aggressively
  const scale = Math.min(viewport.w, viewport.h) * 0.5;
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const nodePos = useMemo(() => {
    const m = new Map();
    const sim = simRef.current;
    for (const n of data.nodes) {
      const s = sim.get(n.id);
      if (!s) continue;
      m.set(n.id, { x: cx + s.x * scale, y: cy + s.y * scale });
    }
    return m;
  }, [data.nodes, viewport.w, viewport.h, time]);

  const maxMention = Math.max(1, ...data.nodes.map(n => n.mention_count || 0));
  const sizeFor  = (n) => 6 + 18 * Math.sqrt((n.mention_count || 1) / maxMention);
  const colorFor = (n) => ENTITY_KIND_COLORS[n.kind] || "#888";

  // Auto-fit on first stable layout
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    if (data.nodes.length === 0) return;
    // wait ~1.2s for sim to settle before fitting
    const t = setTimeout(() => {
      if (didFitRef.current) return;
      const positions = data.nodes.map(n => nodePos.get(n.id)).filter(Boolean);
      if (!positions.length) return;
      const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX, h = maxY - minY;
      if (!w || !h) return;
      const pad = 80;
      const sx = (viewport.w - pad * 2) / w;
      const sy = (viewport.h - pad * 2) / h;
      const k = Math.min(sx, sy, 1.6);
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      setTransform({
        k,
        x: viewport.w / 2 - midX * k,
        y: viewport.h / 2 - midY * k,
      });
      didFitRef.current = true;
    }, 1200);
    return () => clearTimeout(t);
  }, [data.nodes.length, viewport.w, viewport.h]);

  // kind-filter visibility
  const visibleNodeIds = useMemo(() => {
    if (!kindFilter || !kindFilter.size) return null;
    return new Set(data.nodes.filter(n => kindFilter.has(n.kind || "other")).map(n => n.id));
  }, [data.nodes, kindFilter]);

  const visibleNodes = useMemo(
    () => visibleNodeIds ? data.nodes.filter(n => visibleNodeIds.has(n.id)) : data.nodes,
    [data.nodes, visibleNodeIds]
  );
  const visibleEdges = useMemo(
    () => visibleNodeIds ? data.edges.filter(e => visibleNodeIds.has(e.src) && visibleNodeIds.has(e.dst)) : data.edges,
    [data.edges, visibleNodeIds]
  );

  const hoverNeighbors = useMemo(() => {
    if (!hoverId) return null;
    const s = new Set([hoverId]);
    visibleEdges.forEach(e => {
      if (e.src === hoverId) s.add(e.dst);
      if (e.dst === hoverId) s.add(e.src);
    });
    return s;
  }, [hoverId, visibleEdges]);

  // Always-label: top-mention nodes, but skip if a higher-priority label is too close (avoid overlap).
  const alwaysLabel = useMemo(() => {
    const sorted = [...visibleNodes].sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));
    const candidates = sorted.slice(0, Math.min(visibleNodes.length, Math.max(12, Math.floor(visibleNodes.length * 0.4))));
    const MIN_LABEL_DIST = 38 / Math.max(transform.k, 0.5); // pixel space — scale-adjusted
    const placed = []; // [{x, y}]
    const kept = new Set();
    for (const n of candidates) {
      const p = nodePos.get(n.id);
      if (!p) continue;
      let tooClose = false;
      for (const q of placed) {
        const dx = p.x - q.x, dy = p.y - q.y;
        if (dx * dx + dy * dy < MIN_LABEL_DIST * MIN_LABEL_DIST) { tooClose = true; break; }
      }
      if (!tooClose) {
        placed.push(p);
        kept.add(n.id);
      }
    }
    return kept;
  }, [visibleNodes, nodePos, transform.k]);

  return (
    <div ref={wrapRef} onMouseDown={handleMouseDown} style={{
      position: "absolute", inset: 0,
      cursor: dragRef.current ? "grabbing" : "grab",
      userSelect: "none",
      background:
        "radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px) 0 0 / 32px 32px," +
        "radial-gradient(ellipse at 50% 50%, rgba(91,157,255,0.04), transparent 70%)",
    }}>
      <svg width={viewport.w} height={viewport.h} style={{ display: "block" }}>
        <defs>
          {Object.entries(ENTITY_KIND_COLORS).map(([k, c]) => (
            <radialGradient key={k} id={`eglow-${k}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={c} stopOpacity="0.85" />
              <stop offset="50%"  stopColor={c} stopOpacity="0.35" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {visibleEdges.map((e, i) => {
            const a = nodePos.get(e.src), b = nodePos.get(e.dst);
            if (!a || !b) return null;
            const group = predicateGroupName(e.predicate);
            const pf = predicateFilter && !predicateFilter.has(group);
            const involved = hoverNeighbors?.has(e.src) && hoverNeighbors?.has(e.dst);
            const dim = (hoverId && !involved) || pf;
            const offset = -((time * 18) % 20);
            return (
              <line key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={predicateColor(e.predicate)}
                strokeWidth={(1.0 + 1.6 * (e.weight || 0.5)) * (involved ? 1.8 : 1)}
                strokeDasharray="10 5"
                strokeDashoffset={offset}
                strokeLinecap="round"
                opacity={dim ? (pf ? 0.04 : 0.08) : 1}
              />
            );
          })}
          {visibleNodes.map(n => {
            const p = nodePos.get(n.id); if (!p) return null;
            const sz = sizeFor(n);
            const dim = hoverId && !hoverNeighbors?.has(n.id);
            return (
              <circle key={`h-${n.id}`}
                cx={p.x} cy={p.y} r={sz * 3.2}
                fill={`url(#eglow-${n.kind || "tech"})`}
                opacity={dim ? 0.06 : 0.55}
                pointerEvents="none"
              />
            );
          })}
          {/* hover edge predicate labels — show predicate text near edge midpoint when an endpoint is hovered */}
          {hoverId && visibleEdges.map((e, i) => {
            if (e.src !== hoverId && e.dst !== hoverId) return null;
            const a = nodePos.get(e.src), b = nodePos.get(e.dst);
            if (!a || !b) return null;
            const group = predicateGroupName(e.predicate);
            if (predicateFilter && !predicateFilter.has(group)) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <text key={`pl-${i}`}
                x={mx} y={my}
                textAnchor="middle"
                fontSize={10 / transform.k}
                fontFamily="Inter,sans-serif"
                fontWeight={600}
                fill="#fff"
                opacity={0.85}
                style={{
                  paintOrder: "stroke",
                  stroke: "#000",
                  strokeWidth: 3 / transform.k,
                  strokeLinejoin: "round",
                  pointerEvents: "none",
                }}
              >{e.predicate}</text>
            );
          })}

          {visibleNodes.map(n => {
            const p = nodePos.get(n.id); if (!p) return null;
            const sz = sizeFor(n);
            const isHover = hoverId === n.id;
            const isSel   = selectedEntityId === n.id;
            const isMatch = searchMatches?.has(n.id);
            const dim = hoverId && !hoverNeighbors?.has(n.id);
            const labelOn = isHover || isSel || isMatch || alwaysLabel.has(n.id);
            const matchPulse = isMatch ? (1 + 0.25 * Math.sin(time * 2.4 + sz)) : 1;
            return (
              <g key={n.id}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={(ev) => { ev.stopPropagation(); onSelect?.(n); }}
                style={{ cursor: "pointer" }}
              >
                {isMatch && (
                  <circle cx={p.x} cy={p.y} r={sz * 2.2 * matchPulse}
                    fill="none" stroke="#fff" strokeWidth={1.2}
                    opacity={0.55 + 0.25 * Math.sin(time * 2.4 + sz)}
                    pointerEvents="none" />
                )}
                <circle cx={p.x} cy={p.y} r={sz}
                  fill={colorFor(n)}
                  opacity={dim ? 0.25 : 1}
                  stroke={isSel ? "#fff" : (isHover ? "rgba(255,255,255,0.85)" : "none")}
                  strokeWidth={isSel ? 2.2 : 1.5}
                />
                {labelOn && (
                  <text
                    x={p.x} y={p.y + sz + 13 / transform.k}
                    textAnchor="middle"
                    fill={isHover || isSel ? "#fff" : "#c0c0d8"}
                    fontSize={12 / transform.k}
                    fontFamily="Inter,sans-serif"
                    fontWeight={isHover || isSel ? 800 : 600}
                    letterSpacing={-0.2}
                    opacity={dim ? 0.3 : 1}
                    style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3.2 / transform.k, strokeLinejoin: "round" }}
                  >{n.name}</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {hoverId && (() => {
        const n = visibleNodes.find(x => x.id === hoverId);
        if (!n) return null;
        const incoming = data.edges.filter(e => e.dst === n.id);
        const outgoing = data.edges.filter(e => e.src === n.id);
        const nameFor = (id) => data.nodes.find(x => x.id === id)?.name || id.slice(0, 8);
        return (
          <div style={{
            position: "absolute", top: 16, left: 16, maxWidth: 340,
            padding: "14px 16px", borderRadius: 10, pointerEvents: "none",
            background: "rgba(10,10,20,0.94)", backdropFilter: "blur(14px)",
            border: `1px solid ${colorFor(n)}44`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorFor(n), boxShadow: `0 0 10px ${colorFor(n)}` }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e6e6f0" }}>{n.name}</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#777", textTransform: "uppercase", letterSpacing: 1 }}>
                {n.kind || "entity"}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>
              {n.mention_count} mention{n.mention_count === 1 ? "" : "s"} · {incoming.length} in · {outgoing.length} out
            </div>
            {outgoing.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Outgoing</div>
                {outgoing.slice(0, 6).map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6 }}>
                    <span style={{ color: "#7ab8ff" }}>{e.predicate}</span>
                    <span style={{ color: "#666" }}> → </span>
                    {nameFor(e.dst)}
                  </div>
                ))}
              </div>
            )}
            {incoming.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Incoming</div>
                {incoming.slice(0, 6).map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6 }}>
                    {nameFor(e.src)}
                    <span style={{ color: "#666" }}> ← </span>
                    <span style={{ color: "#7ab8ff" }}>{e.predicate}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Zoom + reset controls (bottom-left) */}
      <div style={{
        position: "absolute", left: 16, bottom: 16,
        display: "flex", flexDirection: "column", gap: 3,
        background: "rgba(10,10,20,0.85)",
        backdropFilter: "blur(10px)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.07)",
        padding: 4,
      }}>
        <CtrlBtn title="Zoom in"
          onClick={() => setTransform(t => ({ ...t, k: Math.min(8, t.k * 1.3) }))}>+</CtrlBtn>
        <CtrlBtn title="Zoom out"
          onClick={() => setTransform(t => ({ ...t, k: Math.max(0.3, t.k / 1.3) }))}>−</CtrlBtn>
        <CtrlBtn title="Reset view"
          onClick={() => setTransform({ x: 0, y: 0, k: 1 })}>⊙</CtrlBtn>
        <CtrlBtn title="Fit to view"
          onClick={() => {
            const positions = data.nodes.map(n => nodePos.get(n.id)).filter(Boolean);
            if (!positions.length) return;
            const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const minY = Math.min(...ys), maxY = Math.max(...ys);
            const w = maxX - minX, h = maxY - minY;
            const pad = 80;
            const sx = (viewport.w - pad * 2) / Math.max(w, 1);
            const sy = (viewport.h - pad * 2) / Math.max(h, 1);
            const k = Math.min(sx, sy, 1.8);
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;
            setTransform({
              k,
              x: viewport.w / 2 - midX * k,
              y: viewport.h / 2 - midY * k,
            });
          }}>⤢</CtrlBtn>
      </div>

      {/* Mini-map (bottom-right) */}
      {visibleNodes.length > 4 && (
        <Minimap nodes={visibleNodes} nodePos={nodePos}
          viewport={viewport} transform={transform}
          colorFor={colorFor} />
      )}

      {/* Zoom % indicator (top-right) */}
      <div style={{
        position: "absolute", right: 16, top: 16,
        fontSize: 10, color: "#555",
        fontFamily: "var(--mono)",
        background: "rgba(10,10,20,0.7)", backdropFilter: "blur(8px)",
        padding: "4px 8px", borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.05)",
        letterSpacing: 0.5,
        pointerEvents: "none",
      }}>{Math.round(transform.k * 100)}%</div>

      {!data.nodes.length && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#444", pointerEvents: "none",
          textAlign: "center", fontSize: 13, lineHeight: 1.7,
        }}>
          No entities yet.<br />File memories or call /api/memory/&#123;id&#125;/extract to add structure.
        </div>
      )}
    </div>
  );
}
