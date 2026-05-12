import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VexAvatar } from "./VexAvatar.jsx";

// ── constants ────────────────────────────────────────────────────────────────
const KIND_COLORS = {
  episode:   "#5b9dff",
  lesson:    "#ffb454",
  decision:  "#ff6b9d",
  reference: "#7ee787",
};
const KIND_SIZES = {
  decision:  16,
  lesson:    11,
  reference:  8,
  episode:    5,
};
const EDGE_COLORS = {
  semantic: "rgba(120,160,255,0.55)",
  explicit: "rgba(255,180,100,0.85)",
  temporal: "rgba(255,255,255,0.18)",
  cross:    "rgba(184,107,255,0.75)",  // bright purple — bridges projects
};

// Single primary view (Knowledge). Archive + File are drawers/modals.

const ENTITY_KIND_COLORS = {
  project:   "#5b9dff",
  tech:      "#7ee787",
  tool:      "#ffb454",
  system:    "#ff6b9d",
  host:      "#5cdcff",
  domain:    "#b86bff",
  card:      "#a0cfff",
  component: "#888888",
  person:    "#ff9b54",
  product:   "#ff6b54",
  language:  "#9bff9b",
};

// predicate → semantic color group
function predicateColor(p) {
  if (!p) return "rgba(184,164,255,0.5)";
  const s = p.toLowerCase();
  if (/^(uses|built_with|requires|runs_on|reads)$/.test(s))                 return "rgba(126,231,135,0.65)";  // green — tech use
  if (/^(contains|part_of|has_views|builds_as|groups|outputs|models)$/.test(s)) return "rgba(91,157,255,0.65)";  // blue — composition
  if (/^(has_bug|had_bug|had_issue)$/.test(s))                              return "rgba(255,107,107,0.7)";   // red — problems
  if (/^(has_lesson|has_decision|has_design|has_requirement|has_theme)$/.test(s)) return "rgba(255,180,84,0.65)"; // amber — wisdom
  if (/^(lives_at|deploys_to|hosted_on|hosted_at|runs_on_port|stakeholder_of)$/.test(s)) return "rgba(255,107,157,0.65)"; // pink — location/people
  if (/^(related_to|modified_by|opens|diagnoses|built_for|uses_language)$/.test(s)) return "rgba(160,207,255,0.6)";    // light blue
  return "rgba(184,107,255,0.65)";  // purple — other
}

// predicate → semantic group name (for legend)
const PREDICATE_GROUPS = [
  { name: "Tech use",      color: "rgba(126,231,135,0.85)", preds: "uses, built_with, requires, runs_on, reads" },
  { name: "Composition",   color: "rgba(91,157,255,0.85)",  preds: "contains, part_of, groups, outputs, models" },
  { name: "Problems",      color: "rgba(255,107,107,0.85)", preds: "has_bug, had_bug, had_issue" },
  { name: "Wisdom",        color: "rgba(255,180,84,0.85)",  preds: "has_lesson, has_decision, has_design" },
  { name: "Place / People",color: "rgba(255,107,157,0.85)", preds: "lives_at, deploys_to, hosted_on, stakeholder_of" },
];

// ── utils ────────────────────────────────────────────────────────────────────
function heatColor(t) {
  const c = [42,48,80].map((v,i) => Math.round(v + ([255,107,61][i]-v)*t));
  return `rgb(${c.join(",")})`;
}
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function fmtDate(epochSec) {
  if (!epochSec) return "";
  return new Date(epochSec * 1000).toLocaleString();
}

// ── Starfield ───────────────────────────────────────────────────────────────
function Starfield() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    const resize = () => {
      c.width  = c.offsetWidth;
      c.height = c.offsetHeight;
      ctx.clearRect(0, 0, c.width, c.height);
      for (let i = 0; i < 320; i++) {
        const x = Math.random() * c.width;
        const y = Math.random() * c.height;
        const r = Math.random() * 1.4 + 0.1;
        const a = (Math.random()*0.55+0.05).toFixed(2);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fill();
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <canvas ref={ref}
      style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}
    />
  );
}

// stable hash → seed
function hashId(s) {
  let h = 0;
  for (let i = 0; i < (s?.length||0); i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return h;
}

// liveness: 1.0 = fresh+recalled, ~0.25 = stale untouched
function livenessOf(n) {
  const now = Date.now() / 1000;
  const ageDays = Math.max(0, (now - (n.created_at || 0)) / 86400);
  const staleness = Math.min(1, ageDays / 180);
  const accessBoost = Math.min(1, (n.access_count || 0) / 6);
  return Math.max(0.25, 1 - staleness * 0.7 + accessBoost * 0.4);
}

// ── Constellation (force-directed SVG graph) ────────────────────────────────
function Constellation({ nodes, edges, heatMode, maxAccess, onSelect, selectedId, hoverId, setHoverId, matchIds }) {
  const wrapRef = useRef(null);
  const [viewport, setViewport] = useState({ w: 1000, h: 800 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [time, setTime] = useState(0);
  const dragRef  = useRef(null);
  const simRef   = useRef(new Map());   // id → {x, y, vx, vy, project} normalized
  const edgesRef = useRef(edges);       // latest edges for sim loop

  // project anchor — deterministic per project name, places clusters around a ring
  const projAnchor = useCallback((project) => {
    const h = hashId(project || "default");
    const angle  = ((h & 0xFFFF) / 0xFFFF) * Math.PI * 2;
    const radius = 0.45;
    return { ax: Math.cos(angle) * radius, ay: Math.sin(angle) * radius };
  }, []);

  // sync sim entries with current node set — preserve existing positions
  useEffect(() => {
    const next = new Map();
    for (const n of nodes) {
      const ex = simRef.current.get(n.id);
      if (ex) {
        ex.project = n.project;  // update in case it changed
        next.set(n.id, ex);
      } else {
        // seed new node near its project anchor + small jitter
        const a = projAnchor(n.project);
        next.set(n.id, {
          x: a.ax + (Math.random()-0.5) * 0.15,
          y: a.ay + (Math.random()-0.5) * 0.15,
          vx: 0, vy: 0,
          project: n.project,
        });
      }
    }
    simRef.current = next;
  }, [nodes, projAnchor]);

  // keep edges available to the sim without restarting the loop
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // force-directed sim loop + time driver — runs ONCE per mount
  useEffect(() => {
    let raf;
    let last  = performance.now();
    const start = last;

    // tuning (normalized space, ~-1..1)
    const REPEL    = 0.018;
    const SPRING   = 1.8;
    const IDEAL    = 0.18;
    const DAMP     = 0.85;
    const GRAVITY  = 0.28;
    const CLUSTER  = 0.55;   // pull toward project anchor
    const MAX_V    = 1.4;
    const SIM_K    = 6;

    const step = () => {
      const now = performance.now();
      const dt  = Math.min(0.033, (now - last) / 1000);
      last = now;

      const m   = simRef.current;
      const es  = edgesRef.current;
      const arr = [...m.values()];

      // pairwise repulsion
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        for (let j = i+1; j < arr.length; j++) {
          const b  = arr[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx*dx + dy*dy + 0.0008;
          const d  = Math.sqrt(d2);
          const f  = REPEL / d2;
          const fx = (dx/d) * f;
          const fy = (dy/d) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      // edge springs (weight scales pull)
      for (const e of es) {
        const a = m.get(e.src);
        const b = m.get(e.dst);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d  = Math.sqrt(dx*dx + dy*dy) + 0.001;
        const w  = 0.3 + (e.weight || 0.3);
        const force = (d - IDEAL) * SPRING * w;
        const fx = (dx/d) * force;
        const fy = (dy/d) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // gravity + cluster pull + integrate
      for (const n of arr) {
        const anchor = projAnchor(n.project);
        // weak global gravity
        n.vx += -n.x * GRAVITY * dt;
        n.vy += -n.y * GRAVITY * dt;
        // project clustering — pulls node toward its project anchor
        n.vx += (anchor.ax - n.x) * CLUSTER * dt;
        n.vy += (anchor.ay - n.y) * CLUSTER * dt;
        n.vx *= DAMP;
        n.vy *= DAMP;
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
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // initial fit when node count changes
  useEffect(() => {
    if (!nodes.length) return;
    setTransform({ x: 0, y: 0, k: 1 });
  }, [nodes.length]);

  // wheel — must be a non-passive listener so we can preventDefault to stop page scroll
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top  - rect.height / 2;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setTransform(t => {
        const newK = Math.min(8, Math.max(0.3, t.k * factor));
        const dk = newK / t.k;
        return {
          k: newK,
          x: mx - (mx - t.x) * dk,
          y: my - (my - t.y) * dk,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);

  const handleMouseMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setTransform(t => ({ ...t, x: d.tx + dx, y: d.ty + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // map normalized sim coords → pixels
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

  // hover edge set
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
    ? 4 + 8 * ((n.access_count||0)/maxAccess)
    : (KIND_SIZES[n.kind]||5) + Math.sqrt(n.access_count||0) * 0.6;

  const colorFor = (n) => heatMode
    ? heatColor((n.access_count||0)/maxAccess)
    : (KIND_COLORS[n.kind]||"#888");

  return (
    <div ref={wrapRef}
      onMouseDown={handleMouseDown}
      style={{
        position:"absolute", inset:0, cursor: dragRef.current ? "grabbing" : "grab",
        userSelect:"none",
      }}
    >
      <svg width={viewport.w} height={viewport.h} style={{ display:"block" }}>
        <defs>
          {Object.entries(KIND_COLORS).map(([k,c]) => (
            <radialGradient key={k} id={`glow-${k}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={c} stopOpacity="0.9" />
              <stop offset="40%"  stopColor={c} stopOpacity="0.5" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* edges */}
          {edges.map((e, i) => {
            const a = nodePos.get(e.src);
            const b = nodePos.get(e.dst);
            if (!a || !b) return null;
            const involved = hoverNeighbors?.has(e.src) && hoverNeighbors?.has(e.dst);
            const dim = hoverId && !involved;
            // semantic edges flow; explicit pulse; temporal static
            const isFlow  = e.kind === "semantic" || e.kind === "explicit" || e.kind === "cross";
            const isCross = e.kind === "cross";
            const dashLen = isCross ? 18 : 14;
            const offset  = isFlow ? -((time * (isCross ? 16 : 22)) % (dashLen*2)) : 0;
            const pulse   = 0.85 + 0.15 * Math.sin(time * 1.2 + i);
            const baseWidth = (isCross ? 0.8 + 1.5*e.weight : 0.5 + 1.8*e.weight);
            return (
              <line key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={EDGE_COLORS[e.kind] || "rgba(255,255,255,0.12)"}
                strokeWidth={baseWidth * (involved ? 1.9 : 1)}
                strokeDasharray={isFlow ? `${dashLen*0.6} ${dashLen*0.4}` : undefined}
                strokeDashoffset={offset}
                opacity={(dim ? 0.06 : 1) * (involved ? 1 : pulse)}
              />
            );
          })}

          {/* node glow halos (breathing, liveness-tinted) */}
          {nodes.map(n => {
            const p = nodePos.get(n.id);
            if (!p) return null;
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

          {/* node cores */}
          {nodes.map(n => {
            const p = nodePos.get(n.id);
            if (!p) return null;
            const sz = sizeFor(n);
            const isSel = selectedId === n.id;
            const isHover = hoverId === n.id;
            const isMatch = matchIds?.has(n.id);
            const dim = hoverId && !hoverNeighbors?.has(n.id);
            const live = heatMode ? 1 : livenessOf(n);
            const seed = hashId(n.id);
            // pulsing match ring
            const matchPulse = isMatch ? (1 + 0.25 * Math.sin(time * 2.4 + seed)) : 1;
            return (
              <g key={n.id}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={(e) => { e.stopPropagation(); onSelect(n); }}
                style={{ cursor:"pointer" }}
              >
                {isMatch && (
                  <circle
                    cx={p.x} cy={p.y}
                    r={sz * 2.2 * matchPulse}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={1.2}
                    opacity={0.55 + 0.25 * Math.sin(time * 2.4 + seed)}
                    pointerEvents="none"
                  />
                )}
                <circle
                  cx={p.x} cy={p.y}
                  r={sz}
                  fill={colorFor(n)}
                  opacity={dim ? 0.2 : (0.4 + 0.6 * live)}
                  stroke={isSel ? "#fff" : (isHover ? "rgba(255,255,255,0.7)" : "none")}
                  strokeWidth={isSel ? 2 : 1.5}
                  style={{ transition:"opacity 0.15s, r 0.15s" }}
                />
              </g>
            );
          })}

        </g>
      </svg>

      {/* hover card — floating, top-left, full info */}
      {hoverId && (() => {
        const n = nodes.find(x => x.id === hoverId);
        if (!n) return null;
        return (
          <div style={{
            position:"absolute", top:16, left:16, maxWidth:380,
            padding:"12px 14px", borderRadius:10, pointerEvents:"none",
            background:"rgba(10,10,20,0.92)", backdropFilter:"blur(14px)",
            border:`1px solid ${KIND_COLORS[n.kind] || "rgba(255,255,255,0.1)"}33`,
            boxShadow:"0 10px 40px rgba(0,0,0,0.6)",
            animation:"fadeIn 0.12s ease",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{
                width:8, height:8, borderRadius:"50%", flexShrink:0,
                background: KIND_COLORS[n.kind]||"#888",
                boxShadow:`0 0 8px ${KIND_COLORS[n.kind]||"#888"}`,
              }} />
              <span style={{
                fontSize:10, textTransform:"uppercase", letterSpacing:1.3,
                color:KIND_COLORS[n.kind]||"#888", fontWeight:700,
              }}>{n.kind}</span>
              <span style={{ fontSize:10, color:"#444" }}>·</span>
              <span style={{ fontSize:10, color:"#777" }}>{n.project}</span>
              {n.access_count>0 && (
                <>
                  <span style={{ fontSize:10, color:"#444" }}>·</span>
                  <span style={{ fontSize:10, color:"#999" }}>{n.access_count}×</span>
                </>
              )}
            </div>
            <div style={{ fontSize:12, lineHeight:1.55, color:"#d8d8f0" }}>
              {n.preview}
            </div>
            {n.tags && (
              <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:4 }}>
                {n.tags.split(",").filter(Boolean).slice(0,6).map(t => (
                  <span key={t} style={{
                    fontSize:9, padding:"1px 6px", borderRadius:10,
                    background:"rgba(255,255,255,0.04)", color:"#777",
                    border:"1px solid rgba(255,255,255,0.05)",
                  }}>{t}</span>
                ))}
              </div>
            )}
            <div style={{ marginTop:8, fontSize:9, color:"#444", display:"flex", gap:10 }}>
              <span>{timeAgo((n.created_at||0)*1000)}</span>
              <span>liveness {(livenessOf(n)*100).toFixed(0)}%</span>
            </div>
          </div>
        );
      })()}

      {/* zoom controls */}
      <div style={{
        position:"absolute", left:16, bottom:16, display:"flex", flexDirection:"column", gap:4,
        background:"rgba(10,10,20,0.85)", borderRadius:6,
        border:"1px solid rgba(255,255,255,0.08)", padding:4,
      }}>
        <ZoomBtn onClick={() => setTransform(t => ({ ...t, k: Math.min(8, t.k*1.3) }))}>+</ZoomBtn>
        <ZoomBtn onClick={() => setTransform(t => ({ ...t, k: Math.max(0.3, t.k/1.3) }))}>−</ZoomBtn>
        <ZoomBtn onClick={() => setTransform({ x:0, y:0, k:1 })}>⊙</ZoomBtn>
      </div>

      {/* empty state */}
      {!nodes.length && (
        <div style={{
          position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
          color:"#444", pointerEvents:"none", textAlign:"center", fontSize:13, lineHeight:1.7,
        }}>
          Vex's archive is empty.<br/>Switch to <i>File</i> tab to write your first memory.
        </div>
      )}
    </div>
  );
}

function ZoomBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width:28, height:28, border:"none", background:"transparent",
      color:"#aaa", fontSize:16, cursor:"pointer", borderRadius:4,
    }}>{children}</button>
  );
}

// ── Archive (list view) ──────────────────────────────────────────────────────
function Archive({ nodes, onSelect, selectedId }) {
  const [sort, setSort] = useState("recent");
  const sorted = useMemo(() => {
    const arr = [...nodes];
    if (sort === "recent")  arr.sort((a,b) => b.created_at - a.created_at);
    if (sort === "hot")     arr.sort((a,b) => (b.access_count||0) - (a.access_count||0));
    if (sort === "kind")    arr.sort((a,b) => (a.kind||"").localeCompare(b.kind||""));
    return arr;
  }, [nodes, sort]);

  return (
    <div style={{ position:"absolute", inset:0, overflowY:"auto", padding:"24px 32px" }}>
      <div style={{ maxWidth:980, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
          <h2 style={{ margin:0, color:"#e0e0f0", fontWeight:700, fontSize:22, letterSpacing:0.3 }}>
            Archive
            <span style={{ color:"#555", fontSize:14, fontWeight:400, marginLeft:10 }}>
              {nodes.length} memor{nodes.length===1?"y":"ies"}
            </span>
          </h2>
          <div style={{ display:"flex", gap:6 }}>
            {[["recent","Newest"],["hot","Most recalled"],["kind","By kind"]].map(([k,l]) => (
              <button key={k} onClick={() => setSort(k)} style={{
                ...pillStyle, ...(sort===k ? pillActive : null)
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ display:"grid", gap:10 }}>
          {sorted.map(n => (
            <div key={n.id}
              onClick={() => onSelect(n)}
              style={{
                padding:"14px 16px", borderRadius:8, cursor:"pointer",
                background: selectedId===n.id ? "rgba(91,157,255,0.1)" : "rgba(255,255,255,0.025)",
                border: `1px solid ${selectedId===n.id ? "rgba(91,157,255,0.4)" : "rgba(255,255,255,0.05)"}`,
                transition:"all 0.15s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(91,157,255,0.3)"}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = selectedId===n.id ? "rgba(91,157,255,0.4)" : "rgba(255,255,255,0.05)"}
            >
              <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:6 }}>
                <span style={{
                  width:8, height:8, borderRadius:"50%",
                  background: KIND_COLORS[n.kind]||"#888",
                  boxShadow:`0 0 6px ${KIND_COLORS[n.kind]||"#888"}`,
                  flexShrink:0,
                }} />
                <span style={{
                  fontSize:10, textTransform:"uppercase", letterSpacing:1.1,
                  color:KIND_COLORS[n.kind]||"#888", fontWeight:700,
                }}>{n.kind}</span>
                <span style={{ fontSize:11, color:"#555" }}>·</span>
                <span style={{ fontSize:11, color:"#777" }}>{n.project}</span>
                <span style={{ marginLeft:"auto", fontSize:11, color:"#444" }}>
                  {timeAgo(n.created_at*1000)} {n.access_count>0 && `· recalled ${n.access_count}×`}
                </span>
              </div>
              <div style={{ color:"#c8c8dc", fontSize:13, lineHeight:1.5 }}>
                {n.preview}
              </div>
              {n.tags && (
                <div style={{ marginTop:6, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {n.tags.split(",").filter(Boolean).map(t => (
                    <span key={t} style={{
                      fontSize:10, padding:"2px 7px", borderRadius:10,
                      background:"rgba(255,255,255,0.04)", color:"#888",
                      border:"1px solid rgba(255,255,255,0.05)",
                    }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {!nodes.length && (
          <div style={{ color:"#444", textAlign:"center", padding:60 }}>
            No memories to display.
          </div>
        )}
      </div>
    </div>
  );
}

// ── File (write form) ────────────────────────────────────────────────────────
function FileForm({ projects, onWrote, vexSay }) {
  const [content, setContent] = useState("");
  const [project, setProject] = useState("");
  const [kind, setKind]       = useState("episode");
  const [tags, setTags]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/write", {
        method:"POST", headers:{ "content-type":"application/json" },
        body: JSON.stringify({
          content: content.trim(),
          project: project.trim() || "default",
          kind,
          tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setContent(""); setTags("");
      vexSay?.("thumbsup");
      onWrote?.(data);
    } catch (err) {
      setError(err.message);
      vexSay?.("frown");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position:"absolute", inset:0, overflowY:"auto", padding:"32px" }}>
      <form onSubmit={submit} style={{ maxWidth:680, margin:"0 auto" }}>
        <h2 style={{ margin:"0 0 6px", color:"#e0e0f0", fontWeight:700, fontSize:22 }}>
          File a memory
        </h2>
        <p style={{ color:"#555", margin:"0 0 24px", fontSize:13 }}>
          Vex will index and link automatically. Secrets are refused.
        </p>

        <Field label="Memory content">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="What did you learn, decide, or want to remember?"
            rows={6}
            style={inputStyle}
            autoFocus
          />
        </Field>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <Field label="Project">
            <input list="projects-list"
              value={project} onChange={e => setProject(e.target.value)}
              placeholder="default"
              style={inputStyle}
            />
            <datalist id="projects-list">
              {projects.map(p => <option key={p.project} value={p.project} />)}
            </datalist>
          </Field>

          <Field label="Kind">
            <div style={{ display:"flex", gap:6 }}>
              {Object.keys(KIND_COLORS).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  style={{
                    flex:1, padding:"8px 4px", borderRadius:6,
                    border: `1px solid ${kind===k ? KIND_COLORS[k] : "rgba(255,255,255,0.08)"}`,
                    background: kind===k ? `${KIND_COLORS[k]}22` : "rgba(255,255,255,0.02)",
                    color: kind===k ? KIND_COLORS[k] : "#888",
                    fontSize:11, cursor:"pointer", fontWeight:600, textTransform:"capitalize",
                  }}
                >{k}</button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Tags (comma-separated)">
          <input value={tags} onChange={e => setTags(e.target.value)}
            placeholder="auth, bug, api"
            style={inputStyle}
          />
        </Field>

        {error && (
          <div style={{
            padding:"10px 14px", borderRadius:6, marginBottom:14,
            background:"rgba(255,107,107,0.08)", border:"1px solid rgba(255,107,107,0.25)",
            color:"#ff8888", fontSize:12,
          }}>{error}</div>
        )}

        <button type="submit" disabled={submitting || !content.trim()}
          style={{
            width:"100%", padding:"12px", borderRadius:6,
            background: submitting ? "#1a2840" : "linear-gradient(90deg, #5b9dff, #7eb4ff)",
            color:"#fff", border:"none", fontWeight:700, fontSize:13,
            cursor: submitting || !content.trim() ? "not-allowed" : "pointer",
            opacity: !content.trim() ? 0.5 : 1,
            transition:"all 0.15s",
          }}
        >
          {submitting ? "Filing…" : "File memory →"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{
        fontSize:10, textTransform:"uppercase", letterSpacing:1.2,
        color:"#666", marginBottom:7, fontWeight:700,
      }}>{label}</div>
      {children}
    </div>
  );
}

// ── Knowledge view (entity-centric force graph) ──────────────────────────────
// predicate → which PREDICATE_GROUPS.name it belongs to
function predicateGroupName(p) {
  if (!p) return "Other";
  const s = p.toLowerCase();
  if (/^(uses|built_with|requires|runs_on|reads)$/.test(s))                 return "Tech use";
  if (/^(contains|part_of|has_views|builds_as|groups|outputs|models)$/.test(s)) return "Composition";
  if (/^(has_bug|had_bug|had_issue)$/.test(s))                              return "Problems";
  if (/^(has_lesson|has_decision|has_design|has_requirement|has_theme)$/.test(s)) return "Wisdom";
  if (/^(lives_at|deploys_to|hosted_on|hosted_at|runs_on_port|stakeholder_of)$/.test(s)) return "Place / People";
  return "Other";
}

function KnowledgeView({ data, hoverId, setHoverId, kindFilter, predicateFilter, searchMatches, onSelect, selectedEntityId }) {
  const wrapRef = useRef(null);
  const simRef  = useRef(new Map());
  const edgesRef = useRef(data.edges);
  const [viewport, setViewport] = useState({ w: 1000, h: 800 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [time, setTime] = useState(0);
  const dragRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // sync sim positions from data (preserve existing entries)
  useEffect(() => {
    const next = new Map();
    for (const n of data.nodes) {
      const ex = simRef.current.get(n.id);
      if (ex) next.set(n.id, ex);
      else {
        const angle = Math.random() * Math.PI * 2;
        next.set(n.id, {
          x: Math.cos(angle) * 0.4,
          y: Math.sin(angle) * 0.4,
          vx: 0, vy: 0,
        });
      }
    }
    simRef.current = next;
    edgesRef.current = data.edges;
  }, [data]);

  // wheel zoom non-passive
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

  // sim loop
  useEffect(() => {
    let raf;
    let last = performance.now();
    const start = last;
    const REPEL = 0.022, SPRING = 1.4, IDEAL = 0.26, DAMP = 0.85, GRAVITY = 0.22,
          MAX_V = 1.4, SIM_K = 6, KIND_PULL = 0.0018;
    // kind anchors — places each entity-kind cluster around a deterministic ring
    const kindAnchor = (k) => {
      const kinds = Object.keys(ENTITY_KIND_COLORS);
      const idx = kinds.indexOf(k);
      if (idx < 0) return { ax: 0, ay: 0 };
      const angle = (idx / kinds.length) * Math.PI * 2;
      return { ax: Math.cos(angle) * 0.55, ay: Math.sin(angle) * 0.55 };
    };
    // build id → kind map for sim
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
        for (let j = i+1; j < arr.length; j++) {
          const b = arr[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx*dx + dy*dy + 0.001;
          const d  = Math.sqrt(d2);
          const f = REPEL / d2;
          const fx = (dx/d) * f, fy = (dy/d) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      for (const e of edgesRef.current) {
        const a = m.get(e.src), b = m.get(e.dst);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx*dx + dy*dy) + 0.001;
        const force = (d - IDEAL) * SPRING * (e.weight || 0.5);
        const fx = (dx/d) * force, fy = (dy/d) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      for (let i = 0; i < arr.length; i++) {
        const n = arr[i];
        const k = kindById.get(ids[i]);
        const a = kindAnchor(k);
        n.vx += -n.x * GRAVITY * dt;
        n.vy += -n.y * GRAVITY * dt;
        n.vx += (a.ax - n.x) * KIND_PULL;
        n.vy += (a.ay - n.y) * KIND_PULL;
        n.vx *= DAMP; n.vy *= DAMP;
        if (n.vx > MAX_V) n.vx = MAX_V;
        if (n.vx < -MAX_V) n.vx = -MAX_V;
        if (n.vy > MAX_V) n.vy = MAX_V;
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

  const scale = Math.min(viewport.w, viewport.h) * 0.4;
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
  const sizeFor = (n) => 4 + 14 * Math.sqrt((n.mention_count || 1) / maxMention);
  const colorFor = (n) => ENTITY_KIND_COLORS[n.kind] || "#888";

  // visibility filter by kind chips
  const visibleNodeIds = useMemo(() => {
    if (!kindFilter || !kindFilter.size) return null;  // null = show all
    return new Set(data.nodes.filter(n => kindFilter.has(n.kind || "other")).map(n => n.id));
  }, [data.nodes, kindFilter]);

  const visibleNodes = useMemo(() => {
    if (!visibleNodeIds) return data.nodes;
    return data.nodes.filter(n => visibleNodeIds.has(n.id));
  }, [data.nodes, visibleNodeIds]);

  const visibleEdges = useMemo(() => {
    if (!visibleNodeIds) return data.edges;
    return data.edges.filter(e => visibleNodeIds.has(e.src) && visibleNodeIds.has(e.dst));
  }, [data.edges, visibleNodeIds]);

  const hoverNeighbors = useMemo(() => {
    if (!hoverId) return null;
    const s = new Set([hoverId]);
    visibleEdges.forEach(e => {
      if (e.src === hoverId) s.add(e.dst);
      if (e.dst === hoverId) s.add(e.src);
    });
    return s;
  }, [hoverId, visibleEdges]);

  // top-N node IDs (always-labeled). Threshold by mention_count percentile.
  const alwaysLabel = useMemo(() => {
    const sorted = [...visibleNodes].sort((a,b) => (b.mention_count||0) - (a.mention_count||0));
    return new Set(sorted.slice(0, 12).map(n => n.id));
  }, [visibleNodes]);

  return (
    <div ref={wrapRef}
      onMouseDown={handleMouseDown}
      style={{
        position:"absolute", inset:0,
        cursor: dragRef.current ? "grabbing" : "grab",
        userSelect:"none",
      }}
    >
      <svg width={viewport.w} height={viewport.h} style={{ display:"block" }}>
        <defs>
          {Object.entries(ENTITY_KIND_COLORS).map(([k,c]) => (
            <radialGradient key={k} id={`eglow-${k}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={c} stopOpacity="0.85" />
              <stop offset="50%"  stopColor={c} stopOpacity="0.35" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* edges */}
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
                strokeWidth={(0.6 + 1.1*(e.weight||0.5)) * (involved ? 2 : 1)}
                strokeDasharray="8 4"
                strokeDashoffset={offset}
                opacity={dim ? (pf ? 0.04 : 0.06) : 1}
              />
            );
          })}
          {/* halos */}
          {visibleNodes.map(n => {
            const p = nodePos.get(n.id);
            if (!p) return null;
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
          {/* nodes */}
          {visibleNodes.map(n => {
            const p = nodePos.get(n.id);
            if (!p) return null;
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
                style={{ cursor:"pointer" }}
              >
                {isMatch && (
                  <circle
                    cx={p.x} cy={p.y} r={sz * 2.2 * matchPulse}
                    fill="none" stroke="#fff" strokeWidth={1.2}
                    opacity={0.55 + 0.25 * Math.sin(time * 2.4 + sz)}
                    pointerEvents="none"
                  />
                )}
                <circle
                  cx={p.x} cy={p.y} r={sz}
                  fill={colorFor(n)}
                  opacity={dim ? 0.25 : 1}
                  stroke={isSel ? "#fff" : (isHover ? "rgba(255,255,255,0.85)" : "none")}
                  strokeWidth={isSel ? 2.2 : 1.5}
                />
                {labelOn && (
                  <text
                    x={p.x} y={p.y + sz + 11 / transform.k}
                    textAnchor="middle"
                    fill={isHover || isSel ? "#fff" : "#aab"}
                    fontSize={11 / transform.k}
                    fontFamily="Inter,sans-serif"
                    fontWeight={isHover || isSel ? 700 : 500}
                    opacity={dim ? 0.3 : 0.95}
                    style={{ paintOrder:"stroke", stroke:"#000", strokeWidth: 3/transform.k, strokeLinejoin:"round" }}
                  >{n.name}</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* hover detail card */}
      {hoverId && (() => {
        const n = visibleNodes.find(x => x.id === hoverId);
        if (!n) return null;
        const incoming = data.edges.filter(e => e.dst === n.id);
        const outgoing = data.edges.filter(e => e.src === n.id);
        const nameFor = (id) => data.nodes.find(x => x.id === id)?.name || id.slice(0,8);
        return (
          <div style={{
            position:"absolute", top:16, left:16, maxWidth:340,
            padding:"14px 16px", borderRadius:10, pointerEvents:"none",
            background:"rgba(10,10,20,0.94)", backdropFilter:"blur(14px)",
            border:`1px solid ${colorFor(n)}44`,
            boxShadow:"0 12px 40px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <span style={{
                width:10, height:10, borderRadius:"50%", background:colorFor(n),
                boxShadow:`0 0 10px ${colorFor(n)}`,
              }} />
              <span style={{ fontSize:14, fontWeight:700, color:"#e6e6f0" }}>{n.name}</span>
              <span style={{ marginLeft:"auto", fontSize:9, color:"#777", textTransform:"uppercase", letterSpacing:1 }}>
                {n.kind || "entity"}
              </span>
            </div>
            <div style={{ fontSize:10, color:"#666", marginBottom:8 }}>
              {n.mention_count} mention{n.mention_count===1?"":"s"} · {incoming.length} incoming · {outgoing.length} outgoing
            </div>
            {outgoing.length > 0 && (
              <div style={{ marginTop:6 }}>
                <div style={{ fontSize:9, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Outgoing</div>
                {outgoing.slice(0,6).map((e, i) => (
                  <div key={i} style={{ fontSize:11, color:"#aaa", lineHeight:1.6 }}>
                    <span style={{ color:"#7ab8ff" }}>{e.predicate}</span>
                    <span style={{ color:"#666" }}> → </span>
                    {nameFor(e.dst)}
                  </div>
                ))}
              </div>
            )}
            {incoming.length > 0 && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:9, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Incoming</div>
                {incoming.slice(0,6).map((e, i) => (
                  <div key={i} style={{ fontSize:11, color:"#aaa", lineHeight:1.6 }}>
                    {nameFor(e.src)}
                    <span style={{ color:"#666" }}> ← </span>
                    <span style={{ color:"#7ab8ff" }}>{e.predicate}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {!data.nodes.length && (
        <div style={{
          position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
          color:"#444", pointerEvents:"none", textAlign:"center", fontSize:13, lineHeight:1.7,
        }}>
          No entities yet.<br />Agents can call <code>memory/&#123;id&#125;/extract</code> to add structure.
        </div>
      )}
    </div>
  );
}

// ── Login screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onSuccess }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!pw) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) throw new Error(r.status === 401 ? "Wrong password" : `Error ${r.status}`);
      onSuccess();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div style={{
      position:"fixed", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
      background:
        "radial-gradient(circle at 30% 20%, rgba(91,157,255,0.12), transparent 50%)," +
        "radial-gradient(circle at 70% 80%, rgba(184,107,255,0.10), transparent 55%)," +
        "#070710",
      fontFamily:"'Inter','Segoe UI',sans-serif",
      overflow:"hidden",
    }}>
      <Starfield />
      <form onSubmit={submit} style={{
        position:"relative", zIndex:1,
        width:340, padding:"32px 30px",
        background:"rgba(12,12,22,0.78)",
        border:"1px solid rgba(255,255,255,0.08)",
        borderRadius:16,
        backdropFilter:"blur(24px)",
        boxShadow:"0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(91,157,255,0.08) inset",
        animation:"slideIn 0.35s cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:24 }}>
          <div style={{
            width:54, height:54, borderRadius:"50%",
            background:"linear-gradient(135deg, #5b9dff, #b86bff)",
            boxShadow:"0 0 28px rgba(91,157,255,0.55), 0 0 60px rgba(184,107,255,0.25)",
            marginBottom:14,
          }} />
          <div style={{
            fontSize:22, fontWeight:800, letterSpacing:0.3,
            background:"linear-gradient(90deg, #c8d8ff, #e6d5ff)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            backgroundClip:"text", color:"transparent",
          }}>MindVault</div>
          <div style={{ fontSize:10, color:"#555", letterSpacing:1.8, textTransform:"uppercase", marginTop:3 }}>
            Vex · Memory Archive
          </div>
        </div>

        <Field label="Password">
          <input
            ref={ref}
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            style={{
              ...inputStyle,
              padding:"11px 14px",
              fontSize:14,
              letterSpacing:1,
            }}
          />
        </Field>

        {err && (
          <div style={{
            padding:"9px 12px", borderRadius:6, marginBottom:14,
            background:"rgba(255,107,107,0.08)", border:"1px solid rgba(255,107,107,0.25)",
            color:"#ff8888", fontSize:12,
          }}>{err}</div>
        )}

        <button type="submit" disabled={busy || !pw}
          style={{
            width:"100%", padding:"12px", borderRadius:8,
            background: busy || !pw
              ? "rgba(91,157,255,0.18)"
              : "linear-gradient(90deg, #5b9dff, #b86bff)",
            color:"#fff", border:"none", fontWeight:700, fontSize:13,
            letterSpacing:0.5,
            cursor: busy || !pw ? "not-allowed" : "pointer",
            transition:"all 0.15s",
            boxShadow: busy || !pw ? "none" : "0 6px 20px rgba(91,157,255,0.4)",
          }}
        >
          {busy ? "Unlocking…" : "Enter"}
        </button>

        <div style={{
          marginTop:18, fontSize:9, color:"#444", textAlign:"center", letterSpacing:1.2,
        }}>VEX IS WATCHING</div>
      </form>
    </div>
  );
}

// ── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate({ children }) {
  const [state, setState] = useState({ loading: true, authed: false, required: false });

  const check = useCallback(() => {
    return fetch("/api/me", { credentials: "include" })
      .then(r => r.json())
      .then(d => setState({
        loading: false,
        authed: !!d.authenticated,
        required: !!d.auth_required,
      }))
      .catch(() => setState({ loading: false, authed: false, required: true }));
  }, []);

  useEffect(() => { check(); }, [check]);

  if (state.loading) {
    return (
      <div style={{
        position:"fixed", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
        background:"#070710", color:"#444", fontFamily:"'Inter',sans-serif", fontSize:11, letterSpacing:1.5,
      }}>LOADING…</div>
    );
  }
  if (state.required && !state.authed) return <LoginScreen onSuccess={check} />;
  return children;
}

// ── Main App ─────────────────────────────────────────────────────────────────
function MindVaultApp() {
  // Knowledge graph is now the home view. Archive + File live in drawers/modals.
  const [archiveOpen,     setArchiveOpen]     = useState(false);
  const [fileOpen,        setFileOpen]        = useState(false);
  const [predicateFilter, setPredicateFilter] = useState(new Set()); // empty = all groups
  const [graph,           setGraph]           = useState({ nodes:[], edges:[] });
  const [knowledge,       setKnowledge]       = useState({ nodes:[], edges:[], literals:[] });
  const [kindFilter,      setKindFilter]      = useState(new Set());      // empty = all kinds
  const [selectedEntity,  setSelectedEntity]  = useState(null);
  const [entityProfile,   setEntityProfile]   = useState(null);
  const [projects,        setProjects]        = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selected,        setSelected]        = useState(null);
  const [fullMemory,      setFullMemory]      = useState(null);
  const [stats,           setStats]           = useState(null);
  const [version,         setVersion]         = useState(null);
  const [timeFilter,      setTimeFilter]      = useState(1.0);
  const [heatMode,        setHeatMode]        = useState(false);
  const [search,          setSearch]          = useState("");
  const [smartResults,    setSmartResults]    = useState(null);  // {id → score} | null
  const [vexMood,         setVexMood]         = useState("neutral");
  const [hoverId,         setHoverId]         = useState(null);
  const [lastUpdated,     setLastUpdated]     = useState(null);
  const [, forceTick]                         = useState(0);
  const moodTimer = useRef(null);

  const vexSay = useCallback((mood, ms=2500) => {
    setVexMood(mood);
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setVexMood("neutral"), ms);
  }, []);

  // Hash to detect when graph data actually changed
  const lastHashRef = useRef({ m: -1, e: -1 });

  const fetchGraph = useCallback(async () => {
    const url = "/api/graph" + (selectedProject
      ? `?project=${encodeURIComponent(selectedProject)}` : "");
    try {
      const g = await fetch(url).then(r => r.json());
      setGraph(g);
      setLastUpdated(Date.now());
    } catch {}
  }, [selectedProject]);

  const tick = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetch("/api/stats").then(r => r.json()),
        fetch("/api/health").then(r => r.json()).catch(() => ({})),
      ]);
      setStats(s);
      setProjects(s.projects || []);
      setVersion(h.version || null);
      // refetch graph only when memory/edge counts changed
      const ms = s.memories ?? 0;
      const es = s.edges    ?? 0;
      if (ms !== lastHashRef.current.m || es !== lastHashRef.current.e) {
        lastHashRef.current = { m: ms, e: es };
        await fetchGraph();
        // also refresh knowledge whenever memories change
        try {
          const k = await fetch("/api/knowledge").then(r => r.json());
          setKnowledge(k);
        } catch {}
      } else {
        setLastUpdated(Date.now());
      }
    } catch (e) {
      console.error("tick failed", e);
    }
  }, [fetchGraph]);

  // immediate fetch on mount + project change
  useEffect(() => {
    lastHashRef.current = { m: -1, e: -1 };
    tick();
  }, [tick, selectedProject]);

  // live polling — every 2s
  useEffect(() => {
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [tick]);

  useEffect(() => {
    const id = setInterval(() => forceTick(t => t+1), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selected) { setFullMemory(null); return; }
    fetch(`/api/memory/${selected.id}`)
      .then(r => r.json())
      .then(setFullMemory)
      .catch(() => {});
  }, [selected]);

  // entity profile fetch
  useEffect(() => {
    if (!selectedEntity) { setEntityProfile(null); return; }
    fetch(`/api/entity/${selectedEntity.id}`)
      .then(r => r.json())
      .then(setEntityProfile)
      .catch(() => {});
  }, [selectedEntity]);

  // keyboard nav: '/' focus search, esc close, 1/2/3 views, 'f' fit
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (fileOpen) setFileOpen(false);
        else if (archiveOpen) setArchiveOpen(false);
        else if (selectedEntity) setSelectedEntity(null);
        else if (selected || fullMemory) { setSelected(null); setFullMemory(null); }
        else if (search) setSearch("");
        else if (inField) t.blur();
        return;
      }
      if (inField) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "n") setFileOpen(true);
      else if (e.key === "a") setArchiveOpen(true);
      else if (e.key === "r" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); tick(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, fullMemory, selectedEntity, search, fileOpen, archiveOpen, tick]);

  // filter pipeline
  const timeFiltered = useMemo(() => {
    if (!graph.nodes.length) return graph;
    const times = graph.nodes.map(n => n.created_at);
    const minT = Math.min(...times), maxT = Math.max(...times);
    const cutoff = minT + (maxT-minT) * (1-timeFilter);
    const okIds = new Set(graph.nodes.filter(n => n.created_at >= cutoff).map(n => n.id));
    return {
      nodes: graph.nodes.filter(n => okIds.has(n.id)),
      edges: graph.edges.filter(e => okIds.has(e.src) && okIds.has(e.dst)),
    };
  }, [graph, timeFilter]);

  // Debounced semantic search — kicks /api/recall when query is meaningful
  useEffect(() => {
    if (!search || search.length < 3) { setSmartResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/recall", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: search,
            project: selectedProject || undefined,
            mode: "smart",
            limit: 20,
            include_neighbors: false,
          }),
        }).then(r => r.json());
        const m = {};
        (r.results || []).forEach(it => { m[it.id] = it.score; });
        setSmartResults(m);
      } catch { setSmartResults(null); }
    }, 220);
    return () => clearTimeout(t);
  }, [search, selectedProject]);

  // visible = union of (smart hits) ∪ (substring matches), keep all edges within
  const visible = useMemo(() => {
    if (!search) return timeFiltered;
    const q = search.toLowerCase();
    const subset = new Set(
      timeFiltered.nodes
        .filter(n =>
          n.preview?.toLowerCase().includes(q) ||
          n.tags?.toLowerCase().includes(q) ||
          n.kind?.includes(q) ||
          n.project?.toLowerCase().includes(q)
        )
        .map(n => n.id)
    );
    if (smartResults) Object.keys(smartResults).forEach(id => subset.add(id));
    const okNodes = timeFiltered.nodes.filter(n => subset.has(n.id));
    const okIds = new Set(okNodes.map(n => n.id));
    return { nodes: okNodes, edges: timeFiltered.edges.filter(e => okIds.has(e.src) && okIds.has(e.dst)) };
  }, [timeFiltered, search, smartResults]);

  // matchIds: IDs to visually highlight (semantic + literal substring matches)
  const matchIds = useMemo(() => {
    if (!search) return null;
    const s = new Set(smartResults ? Object.keys(smartResults) : []);
    const q = search.toLowerCase();
    timeFiltered.nodes.forEach(n => {
      if (n.preview?.toLowerCase().includes(q)) s.add(n.id);
    });
    return s.size ? s : null;
  }, [search, smartResults, timeFiltered]);

  // entityMatches: entity IDs whose name matches the search query (substring)
  const entityMatches = useMemo(() => {
    if (!search) return new Set();
    const q = search.toLowerCase();
    return new Set(
      knowledge.nodes
        .filter(n => (n.name || "").toLowerCase().includes(q) ||
                     (n.canonical || "").includes(q))
        .map(n => n.id)
    );
  }, [search, knowledge.nodes]);

  const maxAccess = useMemo(
    () => Math.max(1, ...visible.nodes.map(n => n.access_count||0)),
    [visible.nodes]
  );

  // related memories for detail panel
  const related = useMemo(() => {
    if (!selected) return [];
    const rel = graph.edges
      .filter(e => e.src === selected.id || e.dst === selected.id)
      .map(e => ({ id: e.src === selected.id ? e.dst : e.src, kind: e.kind, weight: e.weight }))
      .sort((a,b) => b.weight - a.weight);
    const seen = new Set();
    return rel.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map(r => ({ ...r, node: graph.nodes.find(n => n.id === r.id) }))
      .filter(r => r.node)
      .slice(0, 8);
  }, [selected, graph]);

  const deleteSelected = async () => {
    if (!selected) return;
    if (!confirm("Delete this memory? This cannot be undone.")) return;
    await fetch(`/api/memory/${selected.id}`, { method:"DELETE" });
    setSelected(null); setFullMemory(null);
    lastHashRef.current = { m: -1, e: -1 };
    tick();
    vexSay("thumbsup");
  };

  const pruneOrphans = async () => {
    if (!confirm("Delete orphans — memories with no edges and never recalled?")) return;
    const params = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";
    const r = await fetch(`/api/prune-orphans${params}`, { method:"POST" }).then(r=>r.json());
    alert(`Vex pruned ${r.count} orphan${r.count===1?"":"s"}.`);
    lastHashRef.current = { m: -1, e: -1 };
    tick();
  };

  return (
    <div style={{
      display:"flex", height:"100vh", overflow:"hidden",
      fontFamily:"'Inter','Segoe UI',sans-serif",
      background:
        "radial-gradient(ellipse at 25% 15%, rgba(91,157,255,0.07), transparent 55%)," +
        "radial-gradient(ellipse at 80% 90%, rgba(184,107,255,0.06), transparent 60%)," +
        "#070710",
      color:"#c8c8dc",
    }}>
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside style={{
        width:280, flexShrink:0, padding:"20px 16px",
        display:"flex", flexDirection:"column", gap:16, overflowY:"auto",
        background:"rgba(10,10,20,0.85)", backdropFilter:"blur(14px)",
        borderRight:"1px solid rgba(255,255,255,0.06)",
        boxShadow:"4px 0 32px rgba(0,0,0,0.5)", zIndex:5,
      }}>
        {/* Brand */}
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{
              width:30, height:30, borderRadius:"50%",
              background:"linear-gradient(135deg, #5b9dff, #b86bff)",
              boxShadow:"0 0 18px rgba(91,157,255,0.55)",
            }} />
            <div>
              <div style={{
                fontSize:19, fontWeight:800, letterSpacing:0.3,
                background:"linear-gradient(90deg, #d6e3ff, #ead4ff)",
                WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
                backgroundClip:"text",
              }}>
                MindVault
              </div>
              <div style={{ fontSize:9, color:"#555", letterSpacing:1.2, textTransform:"uppercase" }}>
                Vex archive {version && `· v${version}`}
              </div>
            </div>
          </div>
        </div>

        {/* Primary actions */}
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          <button onClick={() => setFileOpen(true)} style={{
            padding:"10px 12px", borderRadius:8, border:"none", cursor:"pointer",
            background:"linear-gradient(135deg, rgba(91,157,255,0.20), rgba(184,107,255,0.16))",
            color:"#cfe0ff", fontSize:12, fontWeight:700, letterSpacing:0.4,
            boxShadow:"0 4px 14px rgba(91,157,255,0.16)",
          }}>＋  File memory</button>
          <button onClick={() => setArchiveOpen(true)} style={{
            padding:"8px 12px", borderRadius:8, cursor:"pointer",
            background:"rgba(255,255,255,0.04)", color:"#aab", fontSize:11, fontWeight:600,
            border:"1px solid rgba(255,255,255,0.06)", letterSpacing:0.3,
          }}>⬚  Browse {stats?.memories ?? 0} memories</button>
        </div>

        {/* Stats — Knowledge centric */}
        <div style={{
          display:"flex", justifyContent:"space-between",
          padding:"10px 12px", borderRadius:8,
          background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.04)",
        }}>
          <Stat label="entities" value={stats?.entities ?? 0} color="#7ee787" />
          <Stat label="triples"  value={stats?.triples ?? 0}  color="#b86bff" />
          <Stat label="visible"  value={knowledge.nodes.length} color="#ffb454" />
        </div>

        {/* Unified search — searches entities + memories */}
        <div style={{ position:"relative" }}>
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entities + memories…  ( / )"
            style={{ ...inputStyle, paddingLeft:30, paddingRight: search ? 28 : 11 }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{
              position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
              background:"none", border:"none", color:"#666", cursor:"pointer",
              fontSize:14, padding:"4px 6px", lineHeight:1,
            }} title="Clear (Esc)">×</button>
          )}
          <span style={{
            position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
            fontSize:13, color:"#444", pointerEvents:"none"
          }}>⌕</span>
        </div>

        {/* Search hits summary */}
        {search && (
          <div style={{ marginTop:-10, fontSize:10, color:"#555", lineHeight:1.5 }}>
            {entityMatches.size} entit{entityMatches.size===1?"y":"ies"}
            {smartResults && ` · ${Object.keys(smartResults).length} memor${Object.keys(smartResults).length===1?"y":"ies"}`}
          </div>
        )}

        {/* Entity kind filter */}
        <div>
          <Label>Entity kinds</Label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {(stats?.entity_kinds || []).map(k => {
              const active = kindFilter.has(k.kind);
              const color = ENTITY_KIND_COLORS[k.kind] || "#888";
              return (
                <button key={k.kind} onClick={() => {
                  setKindFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(k.kind)) next.delete(k.kind); else next.add(k.kind);
                    return next;
                  });
                }} style={{
                  padding:"4px 9px", fontSize:10, fontWeight:600,
                  borderRadius:12,
                  border:`1px solid ${active ? color : "rgba(255,255,255,0.06)"}`,
                  background: active ? `${color}22` : "transparent",
                  color: active ? color : "#888",
                  cursor:"pointer", textTransform:"capitalize",
                }}>{k.kind} <span style={{ opacity:0.55 }}>{k.count}</span></button>
              );
            })}
          </div>
          {kindFilter.size > 0 && (
            <button onClick={() => setKindFilter(new Set())} style={{
              marginTop:6, fontSize:10, color:"#666",
              background:"none", border:"none", cursor:"pointer", padding:0,
            }}>clear</button>
          )}
        </div>

        {/* Edge meaning (also a filter — click to toggle group) */}
        <div>
          <Label>Edge meaning</Label>
          <div style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11 }}>
            {PREDICATE_GROUPS.map(g => {
              const active = predicateFilter.has(g.name);
              return (
                <button key={g.name} onClick={() => {
                  setPredicateFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(g.name)) next.delete(g.name); else next.add(g.name);
                    return next;
                  });
                }} style={{
                  display:"flex", alignItems:"center", gap:8, padding:"4px 6px",
                  background: active ? "rgba(255,255,255,0.04)" : "transparent",
                  border:"none", borderRadius:4,
                  cursor:"pointer", textAlign:"left",
                  opacity: predicateFilter.size && !active ? 0.4 : 1,
                }}>
                  <span style={{ width:18, height:2, background:g.color, borderRadius:1, flexShrink:0 }} />
                  <span style={{ color: active ? "#fff" : "#aaa", fontSize:11 }}>{g.name}</span>
                </button>
              );
            })}
          </div>
          {predicateFilter.size > 0 && (
            <button onClick={() => setPredicateFilter(new Set())} style={{
              marginTop:6, fontSize:10, color:"#666",
              background:"none", border:"none", cursor:"pointer", padding:0,
            }}>show all edges</button>
          )}
        </div>

        {/* Live indicator + actions */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:8, fontSize:10, color:"#555",
            padding:"6px 10px", borderRadius:6,
            background:"rgba(126,231,135,0.04)", border:"1px solid rgba(126,231,135,0.12)",
          }}>
            <span style={{
              width:6, height:6, borderRadius:"50%", background:"#7ee787",
              boxShadow:"0 0 6px #7ee787",
              animation:"pulse 2s ease-in-out infinite",
            }} />
            <span style={{ color:"#7ee787", fontWeight:600, letterSpacing:0.5 }}>LIVE</span>
            <span style={{ marginLeft:"auto", color:"#444" }}>
              {lastUpdated ? timeAgo(lastUpdated) : "…"}
            </span>
          </div>
          <SBtn onClick={pruneOrphans} danger>Prune orphans</SBtn>
        </div>

        {/* Vex */}
        <div style={{
          marginTop:"auto", paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.05)",
          display:"flex", flexDirection:"column", alignItems:"center", gap:6,
        }}>
          <VexAvatar mood={vexMood} size={46} />
          <div style={{ fontSize:10, color:"#555", textAlign:"center", lineHeight:1.5 }}>
            {vexMood==="thumbsup" && <span style={{color:"#7ee787"}}>Filed.</span>}
            {vexMood==="frown"    && <span style={{color:"#ff6b6b"}}>Something off.</span>}
            {vexMood==="neutral"  && "Vex is watching."}
          </div>
          <div style={{
            marginTop:8, fontSize:9, color:"#444", textAlign:"center", lineHeight:1.7,
            display:"flex", flexWrap:"wrap", justifyContent:"center", gap:6,
          }}>
            <span><span className="kbd">/</span> search</span>
            <span><span className="kbd">n</span> new</span>
            <span><span className="kbd">a</span> archive</span>
            <span><span className="kbd">esc</span> close</span>
          </div>
          <button
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.reload();
            }}
            style={{
              marginTop:10, padding:"5px 10px", fontSize:9,
              background:"transparent", border:"1px solid rgba(255,255,255,0.06)",
              color:"#555", borderRadius:6, cursor:"pointer", letterSpacing:1,
              textTransform:"uppercase",
            }}
          >Sign out</button>
        </div>
      </aside>

      {/* ── Main panel ────────────────────────────────────────────────────── */}
      <main style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <Starfield />

        {/* Primary view — knowledge graph always */}
        <KnowledgeView
          data={knowledge}
          hoverId={hoverId}
          setHoverId={setHoverId}
          kindFilter={kindFilter.size ? kindFilter : null}
          predicateFilter={predicateFilter.size ? predicateFilter : null}
          searchMatches={search ? entityMatches : null}
          onSelect={setSelectedEntity}
          selectedEntityId={selectedEntity?.id}
        />

        {/* File memory modal */}
        {fileOpen && (
          <>
            <div onClick={() => setFileOpen(false)} style={{
              position:"absolute", inset:0, zIndex:20,
              background:"rgba(0,0,0,0.5)", backdropFilter:"blur(6px)",
              animation:"fadeIn 0.18s ease",
            }} />
            <div onClick={(e) => e.stopPropagation()} style={{
              position:"absolute", left:"50%", top:"50%", transform:"translate(-50%, -50%)",
              width:540, maxHeight:"85vh", zIndex:21,
              background:"rgba(10,10,20,0.97)",
              border:"1px solid rgba(91,157,255,0.25)",
              borderRadius:14, backdropFilter:"blur(20px)",
              boxShadow:"0 20px 80px rgba(0,0,0,0.8)",
              overflow:"hidden", animation:"slideIn 0.22s cubic-bezier(.2,.8,.2,1)",
            }}>
              <button onClick={() => setFileOpen(false)} style={{
                position:"absolute", right:12, top:12, zIndex:1,
                ...closeBtnStyle,
              }}>×</button>
              <FileForm
                projects={projects}
                onWrote={() => { lastHashRef.current = { m: -1, e: -1 }; tick(); setFileOpen(false); }}
                vexSay={vexSay}
              />
            </div>
          </>
        )}

        {/* Archive drawer (slide-in right) */}
        {archiveOpen && (
          <>
            <div onClick={() => setArchiveOpen(false)} style={{
              position:"absolute", inset:0, zIndex:18,
              background:"rgba(0,0,0,0.35)", backdropFilter:"blur(4px)",
              animation:"fadeIn 0.18s ease",
            }} />
            <div onClick={(e) => e.stopPropagation()} style={{
              position:"absolute", right:0, top:0, bottom:0, width:"min(640px, 80vw)",
              zIndex:19,
              background:"rgba(10,10,20,0.98)",
              borderLeft:"1px solid rgba(91,157,255,0.2)",
              backdropFilter:"blur(24px)",
              boxShadow:"-20px 0 60px rgba(0,0,0,0.7)",
              overflow:"hidden", display:"flex", flexDirection:"column",
              animation:"slideInRight 0.25s cubic-bezier(.2,.8,.2,1)",
            }}>
              <div style={{ display:"flex", alignItems:"center", padding:"16px 22px",
                            borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize:14, fontWeight:700, color:"#e0e0f0" }}>Memory archive</span>
                <span style={{ marginLeft:10, fontSize:11, color:"#666" }}>
                  {visible.nodes.length} {search ? "match" : "memor"}{visible.nodes.length===1?(search?"":"y"):(search?"es":"ies")}
                </span>
                <button onClick={() => setArchiveOpen(false)} style={{
                  marginLeft:"auto", ...closeBtnStyle,
                }}>×</button>
              </div>
              <div style={{ flex:1, position:"relative" }}>
                <Archive
                  nodes={visible.nodes}
                  onSelect={(m) => { setSelected(m); setArchiveOpen(false); }}
                  selectedId={selected?.id}
                />
              </div>
            </div>
          </>
        )}

        {/* Entity profile panel (Knowledge view click) */}
        {selectedEntity && entityProfile && (
          <>
            <div
              onClick={() => setSelectedEntity(null)}
              style={{ position:"absolute", inset:0, zIndex:9,
                background:"rgba(0,0,0,0.15)", animation:"fadeIn 0.18s ease" }}
            />
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position:"absolute", right:20, top:20, width:400, maxHeight:"calc(100vh - 40px)",
                overflowY:"auto", padding:20,
                background:"rgba(10,10,20,0.97)",
                border:`1px solid ${ENTITY_KIND_COLORS[entityProfile.entity.kind] || "#5b9dff"}33`,
                borderRadius:14, backdropFilter:"blur(20px)",
                boxShadow:"0 16px 56px rgba(0,0,0,0.75)", zIndex:10,
                animation:"slideIn 0.22s cubic-bezier(.2,.8,.2,1)",
              }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <span style={{
                  width:12, height:12, borderRadius:"50%",
                  background: ENTITY_KIND_COLORS[entityProfile.entity.kind] || "#888",
                  boxShadow:`0 0 10px ${ENTITY_KIND_COLORS[entityProfile.entity.kind] || "#888"}`,
                }} />
                <span style={{ fontSize:16, fontWeight:800, color:"#e6e6f0" }}>{entityProfile.entity.name}</span>
                <span style={{
                  marginLeft:"auto", fontSize:9, color:"#666", letterSpacing:1.2, textTransform:"uppercase",
                }}>{entityProfile.entity.kind || "entity"}</span>
                <button onClick={() => setSelectedEntity(null)} style={closeBtnStyle}>×</button>
              </div>

              <div style={{
                padding:"8px 12px", borderRadius:6, marginBottom:14,
                background:"rgba(255,255,255,0.025)",
                fontSize:11, color:"#777", display:"flex", gap:14,
              }}>
                <span><b style={{color:"#aaa"}}>{entityProfile.entity.mention_count}</b> mentions</span>
                <span><b style={{color:"#aaa"}}>{entityProfile.triples.length}</b> triples</span>
                <span><b style={{color:"#aaa"}}>{entityProfile.memories.length}</b> memories</span>
              </div>

              {/* outgoing triples */}
              {(() => {
                const out = entityProfile.triples.filter(t => t.subj_id === entityProfile.entity.id);
                if (!out.length) return null;
                return (
                  <div style={{ marginBottom:14 }}>
                    <div style={{
                      fontSize:10, textTransform:"uppercase", letterSpacing:1.3,
                      color:"#666", marginBottom:7, fontWeight:700,
                    }}>Outgoing</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      {out.map((t,i) => (
                        <div key={i} style={{
                          padding:"6px 10px", borderRadius:5,
                          background:"rgba(255,255,255,0.02)",
                          border:"1px solid rgba(255,255,255,0.04)",
                          fontSize:11, color:"#c8c8dc", lineHeight:1.4,
                          display:"flex", gap:8, alignItems:"center",
                        }}>
                          <span style={{
                            width:14, height:2, background:predicateColor(t.predicate),
                            flexShrink:0, borderRadius:1,
                          }} />
                          <span style={{ color:"#7ab8ff", fontWeight:600 }}>{t.predicate}</span>
                          <span style={{ color:"#999" }}>
                            {t.obj_id ? entityProfile.names[t.obj_id]?.name : `"${t.obj_literal}"`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* incoming triples */}
              {(() => {
                const inc = entityProfile.triples.filter(t => t.obj_id === entityProfile.entity.id);
                if (!inc.length) return null;
                return (
                  <div style={{ marginBottom:14 }}>
                    <div style={{
                      fontSize:10, textTransform:"uppercase", letterSpacing:1.3,
                      color:"#666", marginBottom:7, fontWeight:700,
                    }}>Incoming</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      {inc.map((t,i) => (
                        <div key={i} style={{
                          padding:"6px 10px", borderRadius:5,
                          background:"rgba(255,255,255,0.02)",
                          border:"1px solid rgba(255,255,255,0.04)",
                          fontSize:11, color:"#c8c8dc",
                          display:"flex", gap:8, alignItems:"center",
                        }}>
                          <span style={{ color:"#aaa" }}>{entityProfile.names[t.subj_id]?.name}</span>
                          <span style={{ color:"#666" }}>—</span>
                          <span style={{ color:"#7ab8ff", fontWeight:600 }}>{t.predicate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* source memories */}
              {entityProfile.memories.length > 0 && (
                <div>
                  <div style={{
                    fontSize:10, textTransform:"uppercase", letterSpacing:1.3,
                    color:"#666", marginBottom:7, fontWeight:700,
                  }}>From {entityProfile.memories.length} memor{entityProfile.memories.length===1?"y":"ies"}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {entityProfile.memories.map(m => (
                      <div key={m.id}
                        onClick={() => {
                          setSelectedEntity(null);
                          setSelected(m);
                        }}
                        style={{
                          padding:"8px 10px", borderRadius:6, cursor:"pointer",
                          background:"rgba(255,255,255,0.025)",
                          border:"1px solid rgba(255,255,255,0.05)",
                        }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:4 }}>
                          <span style={{
                            width:6, height:6, borderRadius:"50%",
                            background:KIND_COLORS[m.kind]||"#888",
                          }} />
                          <span style={{ fontSize:9, textTransform:"uppercase", letterSpacing:1,
                            color:KIND_COLORS[m.kind]||"#888", fontWeight:700 }}>{m.kind}</span>
                          <span style={{ marginLeft:"auto", fontSize:9, color:"#555" }}>{m.project}</span>
                        </div>
                        <div style={{ fontSize:11, color:"#c8c8dc", lineHeight:1.4 }}>
                          {(m.content||"").slice(0, 140)}{(m.content||"").length>140?"…":""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Click-outside scrim — only when detail open */}
        {fullMemory && (
          <div
            onClick={() => { setSelected(null); setFullMemory(null); }}
            style={{
              position:"absolute", inset:0, zIndex:9,
              background:"rgba(0,0,0,0.15)",
              animation:"fadeIn 0.18s ease",
            }}
          />
        )}

        {/* Detail panel */}
        {fullMemory && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position:"absolute", right:20, top:20, width:380, maxHeight:"calc(100vh - 40px)",
              overflowY:"auto", padding:20,
              background:"rgba(10,10,20,0.97)",
              border:`1px solid ${KIND_COLORS[fullMemory.kind]||"#5b9dff"}33`,
              borderRadius:14, backdropFilter:"blur(20px)",
              boxShadow:"0 16px 56px rgba(0,0,0,0.75)", zIndex:10,
              animation:"slideIn 0.22s cubic-bezier(.2,.8,.2,1)",
            }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{
                  width:10, height:10, borderRadius:"50%", flexShrink:0,
                  background: KIND_COLORS[fullMemory.kind]||"#888",
                  boxShadow:`0 0 8px ${KIND_COLORS[fullMemory.kind]||"#888"}`,
                }} />
                <span style={{
                  fontSize:10, textTransform:"uppercase", letterSpacing:1.3,
                  color:KIND_COLORS[fullMemory.kind]||"#888", fontWeight:700,
                }}>{fullMemory.kind}</span>
              </div>
              <button onClick={() => { setSelected(null); setFullMemory(null); }} style={closeBtnStyle}>×</button>
            </div>

            <div style={{
              fontSize:13, lineHeight:1.7, color:"#d8d8f0", whiteSpace:"pre-wrap",
              maxHeight:240, overflowY:"auto", marginBottom:14,
              paddingRight:6,
            }}>
              {fullMemory.content}
            </div>

            <div style={{
              padding:"10px 12px", borderRadius:6,
              background:"rgba(255,255,255,0.025)",
              fontSize:11, color:"#666", lineHeight:2, marginBottom:14,
            }}>
              <Row label="project"  value={fullMemory.project} />
              <Row label="recalled" value={`${fullMemory.access_count||0}×${fullMemory.last_accessed ? ` · last ${timeAgo(fullMemory.last_accessed*1000)}` : ""}`} />
              <Row label="filed"    value={`${fmtDate(fullMemory.created_at)} · ${timeAgo(fullMemory.created_at*1000)}`} />
              <Row label="liveness" value={(livenessOf(fullMemory)*100).toFixed(0) + "%"} />
              {fullMemory.tags && (
                <div style={{ marginTop:8 }}>
                  <div style={{ color:"#555", fontSize:10, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>tags</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                    {fullMemory.tags.split(",").filter(Boolean).map(t => (
                      <span key={t} style={{
                        fontSize:10, padding:"2px 7px", borderRadius:10,
                        background:"rgba(91,157,255,0.08)", color:"#8db4ff",
                        border:"1px solid rgba(91,157,255,0.15)",
                      }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {related.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{
                  fontSize:10, textTransform:"uppercase", letterSpacing:1.2,
                  color:"#555", marginBottom:8, fontWeight:700,
                }}>Related ({related.length})</div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {related.map(r => (
                    <div key={r.id}
                      onClick={() => setSelected(r.node)}
                      style={{
                        padding:"7px 10px", borderRadius:5, cursor:"pointer",
                        background:"rgba(255,255,255,0.025)",
                        border:"1px solid rgba(255,255,255,0.04)",
                        display:"flex", gap:8, alignItems:"center",
                      }}
                    >
                      <span style={{
                        width:6, height:6, borderRadius:"50%", flexShrink:0,
                        background: KIND_COLORS[r.node.kind]||"#888",
                      }} />
                      <span style={{ fontSize:11, color:"#aaa", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {r.node.preview?.slice(0, 50)}
                      </span>
                      <span style={{ fontSize:9, color:"#555", textTransform:"uppercase" }}>{r.kind}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <SBtn onClick={deleteSelected} danger>Delete from archive</SBtn>
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%     { opacity:0.3; transform:scale(1.5); }
        }
        @keyframes fadeIn {
          from { opacity:0; }
          to   { opacity:1; }
        }
        @keyframes slideIn {
          from { opacity:0; transform: translateX(20px); }
          to   { opacity:1; transform: translateX(0); }
        }
        @keyframes slideInRight {
          from { opacity:0; transform: translateX(60px); }
          to   { opacity:1; transform: translateX(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .kbd {
          display: inline-block;
          padding: 1px 5px;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 9px;
          color: #888;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 3px;
        }
        button:hover { filter: brightness(1.15); }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#1e1e32; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:#2e2e4a; }
        input, textarea, select { font-family:inherit; }
        select option { background:#0e0e1e; color:#c8c8dc; }
        input:focus, textarea:focus, select:focus {
          outline:none; border-color:rgba(91,157,255,0.4) !important;
        }
      `}</style>
    </div>
  );
}

// ── wrapped default export ───────────────────────────────────────────────────
export default function App() {
  return (
    <AuthGate>
      <MindVaultApp />
    </AuthGate>
  );
}

// ── small components ─────────────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign:"center", flex:1 }}>
      <div style={{ fontSize:18, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:9, color:"#555", textTransform:"uppercase", letterSpacing:1 }}>{label}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display:"flex", gap:8 }}>
      <span style={{ color:"#555", minWidth:60, textTransform:"uppercase", fontSize:10, letterSpacing:1 }}>{label}</span>
      <span style={{ color:"#aaa", wordBreak:"break-word" }}>{value}</span>
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize:10, textTransform:"uppercase", letterSpacing:1.1,
      color:"#555", marginBottom:6, fontWeight:700,
    }}>{children}</div>
  );
}

function SBtn({ children, onClick, active, danger, type }) {
  return (
    <button type={type||"button"} onClick={onClick} style={{
      padding:"8px 12px", border:"1px solid",
      borderColor: danger ? "rgba(255,107,107,0.3)" : active ? "#5b9dff" : "rgba(255,255,255,0.07)",
      background:  danger ? "rgba(255,107,107,0.08)" : active ? "rgba(91,157,255,0.18)" : "rgba(255,255,255,0.03)",
      color:       danger ? "#ff8888" : active ? "#5b9dff" : "#c8c8dc",
      borderRadius:6, cursor:"pointer", fontSize:12, flex:1, fontWeight:500,
      transition:"all 0.15s",
    }}>{children}</button>
  );
}

function Legend({ heatMode }) {
  if (heatMode) return (
    <div>
      <Label>Heat (recall freq)</Label>
      <div style={{ height:8, borderRadius:4, background:"linear-gradient(to right, #2a3050, #ff6b3d)" }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#444", marginTop:4 }}>
        <span>cold</span><span>hot</span>
      </div>
    </div>
  );
  return (
    <div>
      <Label>Legend</Label>
      <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize:11, color:"#888" }}>
        {Object.entries(KIND_COLORS).map(([k,c]) => {
          const sz = Math.round((KIND_SIZES[k]||5) * 0.9);
          return (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{
                width:sz, height:sz, borderRadius:"50%", background:c,
                boxShadow:`0 0 ${sz/1.5}px ${c}`, flexShrink:0, display:"inline-block",
              }} />
              <span style={{ color:"#aaa", textTransform:"capitalize" }}>{k}</span>
            </div>
          );
        })}
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", marginTop:8, paddingTop:8 }}>
          <div style={{ fontSize:9, color:"#444", textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>Edges</div>
          {[
            ["semantic", "within project"],
            ["cross",    "across projects"],
            ["explicit", "manual link"],
            ["temporal", "time-adjacent"],
          ].map(([k, desc]) => (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
              <span style={{ width:18, height:2, background:EDGE_COLORS[k], flexShrink:0, borderRadius:1 }} />
              <span style={{ fontSize:10, color:"#888" }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────
const inputStyle = {
  width:"100%", padding:"8px 11px", boxSizing:"border-box",
  background:"#0e0e1e", color:"#d8d8f0", border:"1px solid rgba(255,255,255,0.06)",
  borderRadius:6, fontSize:12, outline:"none", resize:"vertical",
  transition:"border-color 0.15s",
};

const pillStyle = {
  padding:"6px 12px", borderRadius:20, border:"1px solid rgba(255,255,255,0.06)",
  background:"transparent", color:"#777", fontSize:11, fontWeight:600, cursor:"pointer",
  transition:"all 0.15s",
};
const pillActive = {
  background:"rgba(91,157,255,0.15)", color:"#5b9dff", borderColor:"rgba(91,157,255,0.4)",
};

const closeBtnStyle = {
  background:"none", border:"none", color:"#666",
  fontSize:24, cursor:"pointer", lineHeight:1, padding:0, width:24, height:24,
};
