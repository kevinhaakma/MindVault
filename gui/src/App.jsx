import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cosmograph, CosmographProvider, useCosmograph } from "@cosmograph/react";
import { VexAvatar } from "./VexAvatar.jsx";

const KIND_COLORS = {
  episode:   "#5b9dff",
  lesson:    "#ffb454",
  decision:  "#ff6b9d",
  reference: "#7ee787",
};
const EDGE_COLORS = {
  semantic: "rgba(120,160,255,0.4)",
  explicit: "rgba(255,180,100,0.75)",
  temporal: "rgba(255,255,255,0.08)",
};
function heatColor(t) {
  const c = [42,48,80].map((v,i) => Math.round(v + ([255,107,61][i]-v)*t));
  return `rgb(${c})`;
}
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

// ── Starfield ───────────────────────────────────────────────────────────────
function Starfield() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    c.width  = c.offsetWidth;
    c.height = c.offsetHeight;
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      const r = Math.random() * 1.2 + 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,255,255,${(Math.random()*0.4+0.05).toFixed(2)})`;
      ctx.fill();
    }
  }, []);
  return (
    <canvas ref={ref}
      style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}
    />
  );
}

// ── Inner graph component (needs CosmographProvider context) ─────────────────
function GraphCanvas({ nodes, links, onNodeClick }) {
  const { cosmograph } = useCosmograph();

  useEffect(() => {
    if (cosmograph) setTimeout(() => cosmograph.fitView(), 300);
  }, [cosmograph, nodes]);

  return (
    <Cosmograph
      nodes={nodes}
      links={links}
      style={{ position:"absolute", inset:0 }}
      backgroundColor="transparent"
      nodeColor={n => n.color}
      nodeSize={n => n.size}
      linkColor={l => l.color}
      linkWidth={l => l.width}
      linkArrows={false}
      simulationDecay={200}
      simulationFriction={0.85}
      simulationLinkSpring={0.4}
      simulationRepulsion={0.6}
      onNodeClick={onNodeClick}
    />
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────
export default function App() {
  const [graph,           setGraph]           = useState({ nodes:[], edges:[] });
  const [projects,        setProjects]        = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selected,        setSelected]        = useState(null);
  const [fullMemory,      setFullMemory]      = useState(null);
  const [stats,           setStats]           = useState(null);
  const [timeFilter,      setTimeFilter]      = useState(1.0);
  const [heatMode,        setHeatMode]        = useState(false);
  const [search,          setSearch]          = useState("");
  const [vexMood,         setVexMood]         = useState("neutral");
  const [vexQuote,        setVexQuote]        = useState(null);
  const [lastUpdated,     setLastUpdated]     = useState(null);
  const [autoRefresh,     setAutoRefresh]     = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [tick,            setTick]            = useState(0);
  const moodTimer = useRef(null);

  const setMoodBriefly = (mood, ms=2500) => {
    setVexMood(mood);
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setVexMood("neutral"), ms);
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const s   = await fetch("/api/stats").then(r => r.json());
      setStats(s);
      setProjects(s.projects);
      const url = "/api/graph" + (selectedProject
        ? `?project=${encodeURIComponent(selectedProject)}` : "");
      const g   = await fetch(url).then(r => r.json());
      setGraph(g);
      setLastUpdated(Date.now());
      if (g.nodes.length > 0) {
        setMoodBriefly("thumbsup");
        // pick a random node as Vex's quote
        const pick = g.nodes[Math.floor(Math.random() * Math.min(g.nodes.length, 8))];
        setVexQuote(pick?.preview?.slice(0, 90) ?? null);
      }
    } catch (e) {
      console.error("refresh failed", e);
    } finally {
      setRefreshing(false);
    }
  }, [selectedProject]);

  // initial load
  useEffect(() => { refresh(); }, [refresh]);

  // auto-refresh every 30s
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  // live "updated X ago" counter
  useEffect(() => {
    const id = setInterval(() => setTick(t => t+1), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (stats !== null && graph.nodes.length === 0) setVexMood("frown");
  }, [graph.nodes.length, stats]);

  // fetch full content when node clicked
  useEffect(() => {
    if (!selected) { setFullMemory(null); return; }
    fetch(`/api/memory/${selected.id}`)
      .then(r => r.json())
      .then(setFullMemory)
      .catch(() => {});
  }, [selected]);

  // ── filter pipeline ─────────────────────────────────────────────────────
  const timeFiltered = useMemo(() => {
    if (!graph.nodes.length) return graph;
    const times  = graph.nodes.map(n => n.created_at);
    const minT   = Math.min(...times), maxT = Math.max(...times);
    const cutoff = minT + (maxT-minT) * (1-timeFilter);
    const okIds  = new Set(graph.nodes.filter(n => n.created_at >= cutoff).map(n => n.id));
    return {
      nodes: graph.nodes.filter(n => okIds.has(n.id)),
      edges: graph.edges.filter(e => okIds.has(e.src) && okIds.has(e.dst)),
    };
  }, [graph, timeFilter]);

  const visible = useMemo(() => {
    if (!search) return timeFiltered;
    const q = search.toLowerCase();
    const okNodes = timeFiltered.nodes.filter(n =>
      n.preview?.toLowerCase().includes(q) ||
      n.tags?.toLowerCase().includes(q) ||
      n.kind?.includes(q) ||
      n.project?.toLowerCase().includes(q)
    );
    const okIds = new Set(okNodes.map(n => n.id));
    return { nodes: okNodes, edges: timeFiltered.edges.filter(e => okIds.has(e.src) && okIds.has(e.dst)) };
  }, [timeFiltered, search]);

  const maxAccess = useMemo(
    () => Math.max(1, ...visible.nodes.map(n => n.access_count||0)),
    [visible.nodes]
  );

  const cosmoNodes = useMemo(() => visible.nodes.map(n => ({
    id:    n.id,
    x:     n.x * 800,
    y:     n.y * 800,
    color: heatMode ? heatColor((n.access_count||0)/maxAccess) : (KIND_COLORS[n.kind]||"#888"),
    size:  4 + 3 * Math.sqrt((n.access_count||0)/maxAccess),
  })), [visible.nodes, heatMode, maxAccess]);

  const cosmoLinks = useMemo(() => visible.edges.map(e => ({
    source: e.src,
    target: e.dst,
    color:  EDGE_COLORS[e.kind]||"rgba(255,255,255,0.12)",
    width:  0.5 + 2*e.weight,
  })), [visible.edges]);

  const deleteNode = async () => {
    if (!selected) return;
    await fetch(`/api/memory/${selected.id}`, { method:"DELETE" });
    setSelected(null); setFullMemory(null);
    refresh();
  };

  const pruneOrphans = async () => {
    if (!confirm("Delete orphans — no edges, never recalled?")) return;
    const params = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";
    const r = await fetch(`/api/prune-orphans${params}`, { method:"POST" }).then(r=>r.json());
    alert(`Vex pruned ${r.count} orphan${r.count===1?"":"s"}.`);
    refresh();
  };

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"'Inter','Segoe UI',sans-serif", background:"#080810" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div style={{
        width:270, padding:"20px 16px", flexShrink:0, overflowY:"auto",
        display:"flex", flexDirection:"column", gap:18,
        background:"rgba(12,12,22,0.92)", backdropFilter:"blur(12px)",
        borderRight:"1px solid rgba(255,255,255,0.06)",
        boxShadow:"4px 0 32px rgba(0,0,0,0.5)",
      }}>

        {/* Header */}
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontSize:20, fontWeight:800, letterSpacing:0.5, color:"#e0e0f0" }}>
              MindVault
            </div>
            {refreshing && (
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#5b9dff",
                animation:"pulse 1s infinite", flexShrink:0 }} />
            )}
          </div>
          <div style={{ fontSize:11, color:"#444", marginTop:4, display:"flex", gap:10 }}>
            <span style={{ color:"#7ee787" }}>⬡ {stats?.memories??0} memories</span>
            <span style={{ color:"#5b9dff" }}>⟋ {stats?.edges??0} edges</span>
          </div>
          {lastUpdated && (
            <div style={{ fontSize:10, color:"#333", marginTop:3, display:"flex", alignItems:"center", gap:6 }}>
              <span>{timeAgo(lastUpdated)}</span>
              <label style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:4, marginLeft:"auto" }}>
                <input type="checkbox" checked={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.checked)}
                  style={{ accentColor:"#5b9dff", cursor:"pointer" }} />
                <span style={{ color:"#555" }}>auto</span>
              </label>
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ position:"relative" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search memories…"
            style={{
              width:"100%", padding:"7px 10px 7px 30px", boxSizing:"border-box",
              background:"#0e0e1e", color:"#c8c8dc", border:"1px solid #1e1e32",
              borderRadius:6, fontSize:12, outline:"none",
            }}
          />
          <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)",
            fontSize:13, color:"#444", pointerEvents:"none" }}>⌕</span>
        </div>

        {/* Project */}
        <div>
          <Label>Project</Label>
          <select value={selectedProject||""} onChange={e => setSelectedProject(e.target.value||null)}
            style={selectStyle}>
            <option value="">All projects</option>
            {projects.map(p => (
              <option key={p.project} value={p.project}>{p.project} ({p.count})</option>
            ))}
          </select>
        </div>

        {/* Time window */}
        <div>
          <Label>Time window: {Math.round(timeFilter*100)}%</Label>
          <input type="range" min="0.05" max="1" step="0.01" value={timeFilter}
            onChange={e => setTimeFilter(+e.target.value)}
            style={{ width:"100%", accentColor:"#5b9dff" }} />
        </div>

        {/* View mode */}
        <div>
          <Label>View mode</Label>
          <div style={{ display:"flex", gap:6 }}>
            <Btn active={!heatMode} onClick={() => setHeatMode(false)}>By kind</Btn>
            <Btn active={heatMode}  onClick={() => setHeatMode(true)}>Heat</Btn>
          </div>
        </div>

        <Legend heatMode={heatMode} />

        {/* Actions */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <Btn onClick={refresh}>↺ Refresh</Btn>
          <Btn onClick={pruneOrphans} danger>Prune orphans</Btn>
        </div>

        {/* Vex */}
        <div style={{
          marginTop:"auto", paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.05)",
          display:"flex", flexDirection:"column", alignItems:"center", gap:6,
        }}>
          {vexQuote && (
            <div style={{
              fontSize:10, color:"#556", lineHeight:1.5, textAlign:"center",
              padding:"6px 10px", background:"rgba(91,157,255,0.05)",
              border:"1px solid rgba(91,157,255,0.1)", borderRadius:6, marginBottom:4,
              fontStyle:"italic",
            }}>
              "{vexQuote}…"
            </div>
          )}
          <VexAvatar mood={vexMood} size={46} />
          <div style={{ fontSize:10, color:"#444", textAlign:"center" }}>
            {vexMood==="thumbsup" && <span style={{color:"#7ee787"}}>Archive updated.</span>}
            {vexMood==="frown"    && <span style={{color:"#ff6b6b"}}>Nothing to display.</span>}
            {vexMood==="neutral"  && "Vex is watching."}
          </div>
        </div>
      </div>

      {/* ── Graph canvas ─────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <Starfield />
        <CosmographProvider>
          <GraphCanvas nodes={cosmoNodes} links={cosmoLinks} onNodeClick={n => setSelected(n||null)} />
        </CosmographProvider>

        {/* Node detail card */}
        {fullMemory && (
          <div style={{
            position:"absolute", right:20, top:20, width:340, maxHeight:"70vh",
            overflowY:"auto", padding:18,
            background:"rgba(10,10,20,0.96)", border:"1px solid rgba(91,157,255,0.2)",
            borderRadius:10, backdropFilter:"blur(16px)", zIndex:10,
            boxShadow:"0 8px 40px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{
                  width:8, height:8, borderRadius:"50%", flexShrink:0,
                  background: KIND_COLORS[fullMemory.kind]||"#888",
                  boxShadow:`0 0 6px ${KIND_COLORS[fullMemory.kind]||"#888"}`,
                }} />
                <span style={{ fontSize:10, textTransform:"uppercase", letterSpacing:1.2,
                  color:KIND_COLORS[fullMemory.kind]||"#888", fontWeight:700 }}>
                  {fullMemory.kind}
                </span>
              </div>
              <button onClick={() => { setSelected(null); setFullMemory(null); }} style={closeBtnStyle}>×</button>
            </div>

            <div style={{ marginTop:12, fontSize:13, lineHeight:1.65, color:"#d8d8f0" }}>
              {fullMemory.content}
            </div>

            <div style={{
              marginTop:14, padding:"10px 12px",
              background:"rgba(255,255,255,0.03)", borderRadius:6,
              fontSize:11, color:"#555", lineHeight:2,
            }}>
              <Row label="project" value={fullMemory.project} />
              <Row label="recalled" value={`${fullMemory.access_count||0}×`} />
              <Row label="filed" value={new Date(fullMemory.created_at*1000).toLocaleString()} />
              {fullMemory.tags && <Row label="tags" value={fullMemory.tags} />}
            </div>

            <div style={{ marginTop:12 }}>
              <Btn onClick={deleteNode} danger>Delete from archive</Btn>
            </div>
          </div>
        )}

        {/* Empty state */}
        {visible.nodes.length === 0 && (
          <div style={{
            position:"absolute", inset:0, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center",
            color:"#333", pointerEvents:"none",
          }}>
            <div style={{ fontSize:13, maxWidth:300, textAlign:"center", lineHeight:1.7 }}>
              {search
                ? `No memories match "${search}"`
                : "Vex's archive is empty.\nUse the MCP remember tool to start filing."
              }
            </div>
          </div>
        )}

        {/* Node count badge */}
        {visible.nodes.length > 0 && (
          <div style={{
            position:"absolute", bottom:20, right:20, padding:"4px 10px",
            background:"rgba(10,10,20,0.8)", border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:20, fontSize:11, color:"#444",
          }}>
            {visible.nodes.length} node{visible.nodes.length!==1?"s":""} visible
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:0.4; transform:scale(1.4); }
        }
        input[type=range]::-webkit-slider-thumb { cursor:pointer; }
        select option { background:#0e0e1e; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#1e1e32; border-radius:4px; }
      `}</style>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display:"flex", gap:8 }}>
      <span style={{ color:"#666", minWidth:56 }}>{label}</span>
      <span style={{ color:"#aaa", wordBreak:"break-all" }}>{value}</span>
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize:10, textTransform:"uppercase", letterSpacing:1.1,
      color:"#555", marginBottom:6, fontWeight:700,
    }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, active, danger }) {
  return (
    <button onClick={onClick} style={{
      padding:"8px 12px", border:"1px solid",
      borderColor: danger ? "rgba(255,107,107,0.3)" : active ? "#5b9dff" : "rgba(255,255,255,0.07)",
      background:  danger ? "rgba(255,107,107,0.08)" : active ? "rgba(91,157,255,0.18)" : "rgba(255,255,255,0.03)",
      color:       danger ? "#ff6b6b" : active ? "#5b9dff" : "#c8c8dc",
      borderRadius:6, cursor:"pointer", fontSize:12, flex:1,
      transition:"all 0.15s ease",
    }}>
      {children}
    </button>
  );
}

function Legend({ heatMode }) {
  if (heatMode) return (
    <div>
      <Label>Heat (recall frequency)</Label>
      <div style={{ height:8, borderRadius:4, background:"linear-gradient(to right, #2a3050, #ff6b3d)" }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#444", marginTop:4 }}>
        <span>cold</span><span>hot</span>
      </div>
    </div>
  );
  return (
    <div>
      <Label>Kinds</Label>
      <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize:12, color:"#888" }}>
        {Object.entries(KIND_COLORS).map(([k,c]) => (
          <div key={k} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:c,
              boxShadow:`0 0 4px ${c}`, flexShrink:0 }} />
            {k}
          </div>
        ))}
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", marginTop:6, paddingTop:8 }}>
          <Label>Edges</Label>
          {[["semantic",EDGE_COLORS.semantic],["explicit",EDGE_COLORS.explicit],["temporal",EDGE_COLORS.temporal]].map(([k,c]) => (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
              <span style={{ width:18, height:2, background:c, flexShrink:0, borderRadius:1 }} />
              <span style={{ fontSize:11 }}>{k}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const selectStyle = {
  width:"100%", padding:"7px 10px", background:"#0e0e1e",
  color:"#c8c8dc", border:"1px solid #1e1e32", borderRadius:6,
  fontSize:12, outline:"none", cursor:"pointer",
};

const closeBtnStyle = {
  background:"none", border:"none", color:"#555",
  fontSize:22, cursor:"pointer", lineHeight:1, padding:0,
  transition:"color 0.1s",
};
