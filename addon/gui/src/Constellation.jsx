import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KIND_COLORS, KIND_SIZES, EDGE_COLORS } from "./constants.js";
import { hashId, heatColor, livenessOf, timeAgo } from "./utils.js";
import { ZoomBtn } from "./ui.jsx";

// Memory-graph force-directed view (drawer/legacy use).
export function Constellation({ nodes, edges, heatMode, maxAccess, onSelect, selectedId, hoverId, setHoverId, matchIds }) {
  const wrapRef = useRef(null);
  const [viewport, setViewport] = useState({ w: 1000, h: 800 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [time, setTime] = useState(0);
  const dragRef  = useRef(null);
  const simRef   = useRef(new Map());
  const edgesRef = useRef(edges);

  const projAnchor = useCallback((project) => {
    const h = hashId(project || "default");
    const angle  = ((h & 0xFFFF) / 0xFFFF) * Math.PI * 2;
    const radius = 0.45;
    return { ax: Math.cos(angle) * radius, ay: Math.sin(angle) * radius };
  }, []);

  useEffect(() => {
    const next = new Map();
    for (const n of nodes) {
      const ex = simRef.current.get(n.id);
      if (ex) { ex.project = n.project; next.set(n.id, ex); }
      else {
        const a = projAnchor(n.project);
        next.set(n.id, {
          x: a.ax + (Math.random() - 0.5) * 0.15,
          y: a.ay + (Math.random() - 0.5) * 0.15,
          vx: 0, vy: 0, project: n.project,
        });
      }
    }
    simRef.current = next;
  }, [nodes, projAnchor]);

  useEffect(() => { edgesRef.current = edges; }, [edges]);

  useEffect(() => {
    let raf;
    let last = performance.now();
    const start = last;
    const REPEL = 0.018, SPRING = 1.8, IDEAL = 0.18, DAMP = 0.85,
          GRAVITY = 0.28, CLUSTER = 0.55, MAX_V = 1.4, SIM_K = 6;
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const m = simRef.current;
      const es = edgesRef.current;
      const arr = [...m.values()];
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.0008;
          const d  = Math.sqrt(d2);
          const f  = REPEL / d2;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      for (const e of es) {
        const a = m.get(e.src), b = m.get(e.dst);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const w = 0.3 + (e.weight || 0.3);
        const force = (d - IDEAL) * SPRING * w;
        const fx = (dx / d) * force, fy = (dy / d) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      for (const n of arr) {
        const anchor = projAnchor(n.project);
        n.vx += -n.x * GRAVITY * dt;
        n.vy += -n.y * GRAVITY * dt;
        n.vx += (anchor.ax - n.x) * CLUSTER * dt;
        n.vy += (anchor.ay - n.y) * CLUSTER * dt;
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
  }, [projAnchor]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!nodes.length) return;
    setTransform({ x: 0, y: 0, k: 1 });
  }, [nodes.length]);

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

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
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

  const scale = Math.min(viewport.w, viewport.h) * 0.42;
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const nodePos = useMemo(() => {
    const m = new Map();
    const sim = simRef.current;
    nodes.forEach(n => {
      const s = sim.get(n.id);
      if (!s) return;
      m.set(n.id, { x: cx + s.x * scale, y: cy + s.y * scale });
    });
    return m;
  }, [nodes, viewport.w, viewport.h, time]);

  const hoverNeighbors = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set([hoverId]);
    edges.forEach(e => {
      if (e.src === hoverId) set.add(e.dst);
      if (e.dst === hoverId) set.add(e.src);
    });
    return set;
  }, [hoverId, edges]);

  const sizeFor = (n) => heatMode
    ? 4 + 8 * ((n.access_count || 0) / maxAccess)
    : (KIND_SIZES[n.kind] || 5) + Math.sqrt(n.access_count || 0) * 0.6;

  const colorFor = (n) => heatMode
    ? heatColor((n.access_count || 0) / maxAccess)
    : (KIND_COLORS[n.kind] || "#888");

  return (
    <div ref={wrapRef} onMouseDown={handleMouseDown} style={{
      position: "absolute", inset: 0,
      cursor: dragRef.current ? "grabbing" : "grab",
      userSelect: "none",
    }}>
      <svg width={viewport.w} height={viewport.h} style={{ display: "block" }}>
        <defs>
          {Object.entries(KIND_COLORS).map(([k, c]) => (
            <radialGradient key={k} id={`glow-${k}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={c} stopOpacity="0.9" />
              <stop offset="40%"  stopColor={c} stopOpacity="0.5" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {edges.map((e, i) => {
            const a = nodePos.get(e.src), b = nodePos.get(e.dst);
            if (!a || !b) return null;
            const involved = hoverNeighbors?.has(e.src) && hoverNeighbors?.has(e.dst);
            const dim = hoverId && !involved;
            const isFlow  = e.kind === "semantic" || e.kind === "explicit" || e.kind === "cross";
            const isCross = e.kind === "cross";
            const dashLen = isCross ? 18 : 14;
            const offset  = isFlow ? -((time * (isCross ? 16 : 22)) % (dashLen * 2)) : 0;
            const pulse   = 0.85 + 0.15 * Math.sin(time * 1.2 + i);
            const baseWidth = (isCross ? 0.8 + 1.5 * e.weight : 0.5 + 1.8 * e.weight);
            return (
              <line key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={EDGE_COLORS[e.kind] || "rgba(255,255,255,0.12)"}
                strokeWidth={baseWidth * (involved ? 1.9 : 1)}
                strokeDasharray={isFlow ? `${dashLen * 0.6} ${dashLen * 0.4}` : undefined}
                strokeDashoffset={offset}
                opacity={(dim ? 0.06 : 1) * (involved ? 1 : pulse)}
              />
            );
          })}

          {nodes.map(n => {
            const p = nodePos.get(n.id); if (!p) return null;
            const sz = sizeFor(n);
            const seed = hashId(n.id);
            const breath = 1 + 0.18 * Math.sin(time * 0.9 + seed * 0.011);
            const halo = sz * 3.5 * breath;
            const isMatch = matchIds?.has(n.id);
            const dim = hoverId && !hoverNeighbors?.has(n.id);
            const live = heatMode ? 1 : livenessOf(n);
            const baseAlpha = heatMode ? 0.18 : 0.5;
            const matchBoost = isMatch ? 1.4 : 1;
            return (
              <circle key={`h-${n.id}`}
                cx={p.x} cy={p.y} r={halo * matchBoost}
                fill={heatMode ? colorFor(n) : `url(#glow-${n.kind || "episode"})`}
                opacity={dim ? 0.05 : baseAlpha * live * matchBoost}
                pointerEvents="none"
              />
            );
          })}

          {nodes.map(n => {
            const p = nodePos.get(n.id); if (!p) return null;
            const sz = sizeFor(n);
            const isSel = selectedId === n.id;
            const isHover = hoverId === n.id;
            const isMatch = matchIds?.has(n.id);
            const dim = hoverId && !hoverNeighbors?.has(n.id);
            const live = heatMode ? 1 : livenessOf(n);
            const seed = hashId(n.id);
            const matchPulse = isMatch ? (1 + 0.25 * Math.sin(time * 2.4 + seed)) : 1;
            return (
              <g key={n.id}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={(e) => { e.stopPropagation(); onSelect(n); }}
                style={{ cursor: "pointer" }}
              >
                {isMatch && (
                  <circle cx={p.x} cy={p.y} r={sz * 2.2 * matchPulse}
                    fill="none" stroke="#fff" strokeWidth={1.2}
                    opacity={0.55 + 0.25 * Math.sin(time * 2.4 + seed)}
                    pointerEvents="none" />
                )}
                <circle cx={p.x} cy={p.y} r={sz}
                  fill={colorFor(n)}
                  opacity={dim ? 0.2 : (0.4 + 0.6 * live)}
                  stroke={isSel ? "#fff" : (isHover ? "rgba(255,255,255,0.7)" : "none")}
                  strokeWidth={isSel ? 2 : 1.5}
                  style={{ transition: "opacity 0.15s, r 0.15s" }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {hoverId && (() => {
        const n = nodes.find(x => x.id === hoverId);
        if (!n) return null;
        return (
          <div style={{
            position: "absolute", top: 16, left: 16, maxWidth: 380,
            padding: "12px 14px", borderRadius: 10, pointerEvents: "none",
            background: "rgba(10,10,20,0.92)", backdropFilter: "blur(14px)",
            border: `1px solid ${KIND_COLORS[n.kind] || "rgba(255,255,255,0.1)"}33`,
            boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
            animation: "fadeIn 0.12s ease",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: KIND_COLORS[n.kind] || "#888",
                boxShadow: `0 0 8px ${KIND_COLORS[n.kind] || "#888"}`,
              }} />
              <span style={{
                fontSize: 10, textTransform: "uppercase", letterSpacing: 1.3,
                color: KIND_COLORS[n.kind] || "#888", fontWeight: 700,
              }}>{n.kind}</span>
              <span style={{ fontSize: 10, color: "#444" }}>·</span>
              <span style={{ fontSize: 10, color: "#777" }}>{n.project}</span>
              {n.access_count > 0 && (
                <>
                  <span style={{ fontSize: 10, color: "#444" }}>·</span>
                  <span style={{ fontSize: 10, color: "#999" }}>{n.access_count}×</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.55, color: "#d8d8f0" }}>{n.preview}</div>
            {n.tags && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {n.tags.split(",").filter(Boolean).slice(0, 6).map(t => (
                  <span key={t} style={{
                    fontSize: 9, padding: "1px 6px", borderRadius: 10,
                    background: "rgba(255,255,255,0.04)", color: "#777",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}>{t}</span>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 9, color: "#444", display: "flex", gap: 10 }}>
              <span>{timeAgo((n.created_at || 0) * 1000)}</span>
              <span>liveness {(livenessOf(n) * 100).toFixed(0)}%</span>
            </div>
          </div>
        );
      })()}

      <div style={{
        position: "absolute", left: 16, bottom: 16,
        display: "flex", flexDirection: "column", gap: 4,
        background: "rgba(10,10,20,0.85)", borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.08)", padding: 4,
      }}>
        <ZoomBtn onClick={() => setTransform(t => ({ ...t, k: Math.min(8, t.k * 1.3) }))}>+</ZoomBtn>
        <ZoomBtn onClick={() => setTransform(t => ({ ...t, k: Math.max(0.3, t.k / 1.3) }))}>−</ZoomBtn>
        <ZoomBtn onClick={() => setTransform({ x: 0, y: 0, k: 1 })}>⊙</ZoomBtn>
      </div>

      {!nodes.length && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "#444", pointerEvents: "none",
          textAlign: "center", fontSize: 13, lineHeight: 1.7,
        }}>
          Vex's archive is empty.<br/>File your first memory to begin.
        </div>
      )}
    </div>
  );
}
