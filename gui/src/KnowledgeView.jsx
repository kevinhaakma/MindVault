import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceX, forceY, forceCollide } from "d3-force";
import {
  ENTITY_KIND_COLORS,
  predicateColor, predicateGroupName, PREDICATE_GROUPS,
} from "./constants.js";

// Each entity kind gets a deterministic anchor on a wide ring — clusters separate visually
const KIND_LIST = Object.keys(ENTITY_KIND_COLORS);
const CLUSTER_RADIUS = 520;
function kindAnchor(kind) {
  const idx = KIND_LIST.indexOf(kind);
  if (idx < 0) return { x: 0, y: 0 };
  const angle = (idx / KIND_LIST.length) * Math.PI * 2 - Math.PI / 2; // start at top
  return { x: Math.cos(angle) * CLUSTER_RADIUS, y: Math.sin(angle) * CLUSTER_RADIUS };
}

export function KnowledgeView({
  data, hoverId, setHoverId, kindFilter, predicateFilter, searchMatches,
  onSelect, selectedEntityId,
}) {
  const wrapRef = useRef(null);
  const fgRef   = useRef(null);
  const [viewport, setViewport] = useState({ w: 1000, h: 800 });

  // Resize
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Build graph data ────────────────────────────────────────────────────
  const maxMention = Math.max(1, ...data.nodes.map(n => n.mention_count || 0));

  const graphData = useMemo(() => {
    let nodes = data.nodes.map(n => ({
      id:            n.id,
      name:          n.name,
      kind:          n.kind,
      mention_count: n.mention_count,
      val:           1 + 2.5 * Math.sqrt((n.mention_count || 1) / maxMention),
      _color:        ENTITY_KIND_COLORS[n.kind] || "#888",
    }));
    let links = data.edges.map(e => ({
      source:    e.src,
      target:    e.dst,
      predicate: e.predicate,
      weight:    e.weight || 0.5,
      _color:    predicateColor(e.predicate),
      _group:    predicateGroupName(e.predicate),
    }));

    // kind filter
    if (kindFilter && kindFilter.size) {
      const keep = new Set(nodes.filter(n => kindFilter.has(n.kind || "other")).map(n => n.id));
      nodes = nodes.filter(n => keep.has(n.id));
      links = links.filter(l => keep.has(l.source) && keep.has(l.target));
    }
    return { nodes, links };
  }, [data, kindFilter, maxMention]);

  // ── Auto-fit + warm-up zoom on data change ──────────────────────────────
  const fitDone = useRef(false);
  const fitStartRef = useRef(null);
  useEffect(() => {
    fitDone.current = false;
    fitStartRef.current = null;
  }, [data.nodes.length]);

  // ── Neighbor sets for focus dimming ─────────────────────────────────────
  const focusId = hoverId || selectedEntityId;
  const neighbors = useMemo(() => {
    if (!focusId) return null;
    const s = new Set([focusId]);
    for (const l of graphData.links) {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      if (sId === focusId) s.add(tId);
      if (tId === focusId) s.add(sId);
    }
    return s;
  }, [focusId, graphData.links]);

  // ── Label budget: every project + top-mention non-projects ──────────────
  const labelBudget = useMemo(() => {
    const projects = graphData.nodes.filter(n => n.kind === "project").map(n => n.id);
    const others = graphData.nodes
      .filter(n => n.kind !== "project")
      .sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0))
      .slice(0, 12)
      .map(n => n.id);
    return new Set([...projects, ...others]);
  }, [graphData.nodes]);

  // ── Custom node painter ─────────────────────────────────────────────────
  const drawNode = useCallback((node, ctx, scale) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const dim     = neighbors && !neighbors.has(node.id);
    const isMatch = searchMatches?.has(node.id);
    const isSel   = node.id === selectedEntityId;
    const isHover = node.id === hoverId;
    const r       = 3 + node.val * 1.5;
    const color   = node._color;

    // Halo glow
    if (!dim) {
      const grad = ctx.createRadialGradient(node.x, node.y, r * 0.6, node.x, node.y, r * 3.5);
      grad.addColorStop(0, color + "aa");
      grad.addColorStop(0.4, color + "44");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Match pulse ring
    if (isMatch) {
      const pulse = 1 + 0.25 * Math.sin(performance.now() / 250);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.3 / scale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 2.2 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Core dot
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = dim ? color + "55" : color;
    ctx.fill();

    // Selected / hover outline
    if (isSel || isHover) {
      ctx.strokeStyle = isSel ? "#fff" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = (isSel ? 2.2 : 1.5) / scale;
      ctx.stroke();
    }

    // Label
    if (labelBudget.has(node.id) || isHover || isSel || isMatch) {
      const fontSize = 11 / scale;
      ctx.font = `${isHover || isSel ? 700 : 600} ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // outline for legibility
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(node.name, node.x, node.y + r + 4 / scale);
      ctx.fillStyle = dim ? "#666" : (isHover || isSel ? "#fff" : "#c0c0d8");
      ctx.fillText(node.name, node.x, node.y + r + 4 / scale);
    }
  }, [neighbors, searchMatches, selectedEntityId, hoverId, labelBudget]);

  // ── Custom link painter ─────────────────────────────────────────────────
  const drawLink = useCallback((link, ctx, scale) => {
    const sx = link.source.x, sy = link.source.y;
    const tx = link.target.x, ty = link.target.y;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
        !Number.isFinite(tx) || !Number.isFinite(ty)) return;
    const sId = typeof link.source === "object" ? link.source.id : link.source;
    const tId = typeof link.target === "object" ? link.target.id : link.target;
    const pf  = predicateFilter && !predicateFilter.has(link._group);
    const dim = pf || (neighbors && !(neighbors.has(sId) && neighbors.has(tId)));
    const involved = focusId && neighbors?.has(sId) && neighbors?.has(tId);

    // gentle curve via quadratic control point
    const dx = tx - sx, dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const curve = Math.min(14, len * 0.04);

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(
      (sx + tx) / 2 + (-dy / len) * curve,
      (sy + ty) / 2 + ( dx / len) * curve,
      tx, ty
    );
    ctx.strokeStyle = link._color;
    ctx.globalAlpha = dim ? (pf ? 0.03 : 0.07) : 1;
    ctx.lineWidth = ((1 + 1.6 * link.weight) * (involved ? 1.7 : 1)) / scale;
    ctx.setLineDash([10 / scale, 5 / scale]);
    ctx.lineDashOffset = -performance.now() / 50;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Predicate label on hover/select focus
    if (focusId && (sId === focusId || tId === focusId)) {
      const mx = (sx + tx) / 2 + (-dy / len) * curve;
      const my = (sy + ty) / 2 + ( dx / len) * curve;
      const fontSize = 9 / scale;
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(link.predicate, mx, my);
      ctx.fillStyle = "#fff";
      ctx.fillText(link.predicate, mx, my);
    }
  }, [neighbors, predicateFilter, focusId]);

  // ── Force tuning ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fgRef.current) return;
    const fg = fgRef.current;
    // strong charge repulsion + long range so clusters keep distance
    fg.d3Force("charge")?.strength(-420).distanceMax(700);
    // moderate link distance — within-cluster links not too tight
    fg.d3Force("link")?.distance(95).strength(0.3);
    if (fg.d3Force("center")) fg.d3Force("center").strength(0.01);
    // kind clustering — pull each node toward its kind anchor on the wide ring
    fg.d3Force("kindX", forceX(n => kindAnchor(n.kind).x).strength(0.18));
    fg.d3Force("kindY", forceY(n => kindAnchor(n.kind).y).strength(0.18));
    // hard collision — nodes can't overlap (radius scales with mention_count)
    fg.d3Force("collide", forceCollide(n => 12 + n.val * 3).strength(0.95).iterations(2));
    fg.d3ReheatSimulation();
  }, [graphData.nodes.length]);

  // ── Zoom % ──────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);

  return (
    <div ref={wrapRef} style={{
      position: "absolute", inset: 0,
      background:
        "radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px) 0 0 / 32px 32px," +
        "radial-gradient(ellipse at 50% 50%, rgba(91,157,255,0.04), transparent 70%)",
      userSelect: "none",
    }}>
      <ForceGraph2D
        ref={fgRef}
        width={viewport.w}
        height={viewport.h}
        graphData={graphData}
        backgroundColor="transparent"
        cooldownTime={Infinity}
        cooldownTicks={Infinity}
        warmupTicks={60}
        onEngineTick={() => {
          if (!fitDone.current && fgRef.current) {
            // first-fit ~1s after start (no onEngineStop fires when cooldown is Infinity)
            const now = performance.now();
            if (!fitStartRef.current) fitStartRef.current = now;
            if (now - fitStartRef.current > 1500) {
              fgRef.current.zoomToFit(400, 80);
              fitDone.current = true;
            }
          }
        }}
        onZoom={({ k }) => setZoom(k)}
        nodeRelSize={4}
        nodeVal={(n) => n.val * n.val}
        linkSource="source"
        linkTarget="target"
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
          const r = (3 + node.val * 1.5) * 1.8;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fill();
        }}
        linkCanvasObject={drawLink}
        linkCanvasObjectMode={() => "replace"}
        onNodeHover={(node) => setHoverId(node?.id || null)}
        onNodeClick={(node) => onSelect?.(node)}
        onBackgroundClick={() => onSelect?.(null)}
        enableNodeDrag={true}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.45}
        d3AlphaMin={0.0005}
      />

      {/* Zoom controls */}
      <div style={{
        position: "absolute", left: 16, bottom: 16,
        display: "flex", flexDirection: "column", gap: 3,
        background: "rgba(10,10,20,0.85)", backdropFilter: "blur(10px)",
        borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", padding: 4,
      }}>
        <CtrlBtn title="Zoom in" onClick={() => fgRef.current?.zoom(zoom * 1.3, 200)}>+</CtrlBtn>
        <CtrlBtn title="Zoom out" onClick={() => fgRef.current?.zoom(zoom / 1.3, 200)}>−</CtrlBtn>
        <CtrlBtn title="Fit to view" onClick={() => fgRef.current?.zoomToFit(400, 80)}>⤢</CtrlBtn>
        <CtrlBtn title="Reset" onClick={() => fgRef.current?.centerAt(0, 0, 400)}>⊙</CtrlBtn>
      </div>

      {/* Zoom % */}
      <div style={{
        position: "absolute", right: 16, top: 16,
        fontSize: 10, color: "#555",
        fontFamily: "var(--mono)",
        background: "rgba(10,10,20,0.7)", backdropFilter: "blur(8px)",
        padding: "4px 8px", borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.05)",
        letterSpacing: 0.5, pointerEvents: "none",
      }}>{Math.round(zoom * 100)}%</div>

      {!data.nodes.length && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#444", pointerEvents: "none",
          textAlign: "center", fontSize: 13, lineHeight: 1.7,
        }}>
          No entities yet.<br />File memories or call /api/memory/&#123;id&#125;/extract.
        </div>
      )}
    </div>
  );
}

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
