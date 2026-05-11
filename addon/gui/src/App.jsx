import React, { useEffect, useMemo, useRef, useState } from "react";
import { Cosmograph, CosmographProvider } from "@cosmograph/react";
import { VexAvatar } from "./VexAvatar.jsx";

const KIND_COLORS = {
  episode:   "#5b9dff",
  lesson:    "#ffb454",
  decision:  "#ff6b9d",
  reference: "#7ee787",
};

const EDGE_COLORS = {
  semantic: "rgba(120, 160, 255, 0.35)",
  explicit: "rgba(255, 180, 100, 0.7)",
  temporal: "rgba(255, 255, 255, 0.1)",
};

function heatColor(t) {
  const cold = [42, 48, 80];
  const hot  = [255, 107, 61];
  const c    = cold.map((v, i) => Math.round(v + (hot[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export default function App() {
  const [graph,           setGraph]           = useState({ nodes: [], edges: [] });
  const [projects,        setProjects]        = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selected,        setSelected]        = useState(null);
  const [stats,           setStats]           = useState(null);
  const [timeFilter,      setTimeFilter]      = useState(1.0);
  const [heatMode,        setHeatMode]        = useState(false);
  const [vexMood,         setVexMood]         = useState("neutral");
  const moodTimer = useRef(null);

  const setMoodBriefly = (mood, ms = 2500) => {
    setVexMood(mood);
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setVexMood("neutral"), ms);
  };

  const refresh = async () => {
    try {
      const s   = await fetch("/api/stats").then(r => r.json());
      setStats(s);
      setProjects(s.projects);
      const url = "/api/graph" + (selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "");
      const g   = await fetch(url).then(r => r.json());
      setGraph(g);
      if (g.nodes.length > 0) setMoodBriefly("thumbsup");
    } catch (e) {
      console.error("refresh failed", e);
    }
  };

  useEffect(() => { refresh(); }, [selectedProject]);

  // Filter by time window
  const visible = useMemo(() => {
    if (!graph.nodes.length) return graph;
    const times  = graph.nodes.map(n => n.created_at);
    const minT   = Math.min(...times);
    const maxT   = Math.max(...times);
    const cutoff = minT + (maxT - minT) * (1 - timeFilter);
    const okIds  = new Set(graph.nodes.filter(n => n.created_at >= cutoff).map(n => n.id));
    return {
      nodes: graph.nodes.filter(n => okIds.has(n.id)),
      edges: graph.edges.filter(e => okIds.has(e.src) && okIds.has(e.dst)),
    };
  }, [graph, timeFilter]);

  useEffect(() => {
    if (stats !== null && visible.nodes.length === 0) setVexMood("frown");
  }, [visible.nodes.length, stats]);

  const maxAccess = useMemo(
    () => Math.max(1, ...visible.nodes.map(n => n.access_count || 0)),
    [visible.nodes]
  );

  // Derived cosmograph data
  const cosmoNodes = useMemo(() => visible.nodes.map(n => ({
    id:    n.id,
    x:     n.x * 800,
    y:     n.y * 800,
    color: heatMode
      ? heatColor((n.access_count || 0) / maxAccess)
      : (KIND_COLORS[n.kind] || "#888"),
    size: 4 + 3 * Math.sqrt((n.access_count || 0) / maxAccess),
  })), [visible.nodes, heatMode, maxAccess]);

  const cosmoLinks = useMemo(() => visible.edges.map(e => ({
    source: e.src,
    target: e.dst,
    color:  EDGE_COLORS[e.kind] || "rgba(255,255,255,0.15)",
    width:  0.5 + 2 * e.weight,
  })), [visible.edges]);

  const selectedNode = selected ? graph.nodes.find(n => n.id === selected.id) : null;

  const deleteNode = async () => {
    if (!selectedNode) return;
    await fetch(`/api/memory/${selectedNode.id}`, { method: "DELETE" });
    setSelected(null);
    refresh();
  };

  const pruneOrphans = async () => {
    if (!confirm("Delete orphan nodes — no connections, never recalled?")) return;
    const params = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";
    const r      = await fetch(`/api/prune-orphans${params}`, { method: "POST" }).then(r => r.json());
    alert(`Vex pruned ${r.count} orphan${r.count === 1 ? "" : "s"}.`);
    refresh();
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: 280, padding: "16px 14px", background: "#11111c",
        borderRight: "1px solid #1e1e2e", display: "flex",
        flexDirection: "column", gap: 16, overflowY: "auto", flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 0.3 }}>MindVault</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>
            {stats
              ? `${stats.memories} memories · ${stats.edges} edges`
              : "connecting to Vex…"}
          </div>
        </div>

        <div>
          <Label title="Which project constellation to display">Project</Label>
          <select
            value={selectedProject || ""}
            onChange={(e) => setSelectedProject(e.target.value || null)}
            style={selectStyle}
          >
            <option value="">All projects</option>
            {projects.map(p => (
              <option key={p.project} value={p.project}>
                {p.project} ({p.count})
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label title="Show only memories from the most recent portion of history">
            Time window: {Math.round(timeFilter * 100)}%
          </Label>
          <input
            type="range" min="0.05" max="1" step="0.01"
            value={timeFilter}
            onChange={(e) => setTimeFilter(+e.target.value)}
            style={{ width: "100%", accentColor: "#5b9dff" }}
          />
        </div>

        <div>
          <Label title="Color by memory kind, or by recall frequency">View mode</Label>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn active={!heatMode} onClick={() => setHeatMode(false)}>By kind</Btn>
            <Btn active={heatMode}  onClick={() => setHeatMode(true)}>Heat</Btn>
          </div>
        </div>

        <Legend heatMode={heatMode} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn onClick={refresh} title="Reload graph and stats from Vex">Refresh</Btn>
          <Btn onClick={pruneOrphans} danger title="Delete unconnected, never-recalled nodes">
            Prune orphans
          </Btn>
        </div>

        {/* Vex avatar */}
        <div style={{
          marginTop: "auto", display: "flex", flexDirection: "column",
          alignItems: "center", paddingTop: 8, borderTop: "1px solid #1e1e2e", gap: 4,
        }}>
          <VexAvatar mood={vexMood} size={48} />
          <div style={{ fontSize: 10, color: "#555", textAlign: "center" }}>
            {vexMood === "thumbsup" && "Archive updated."}
            {vexMood === "frown"    && "Nothing to display."}
            {vexMood === "neutral"  && "Vex is watching."}
          </div>
        </div>
      </div>

      {/* ── Graph canvas ── */}
      <div style={{ flex: 1, position: "relative" }}>
        <CosmographProvider nodes={cosmoNodes} links={cosmoLinks}>
          <Cosmograph
            style={{ position: "absolute", inset: 0 }}
            backgroundColor="#0a0a12"
            nodeColor={(n) => n.color}
            nodeSize={(n) => n.size}
            linkColor={(l) => l.color}
            linkWidth={(l) => l.width}
            linkArrows={false}
            simulationFriction={0.85}
            simulationLinkSpring={0.4}
            simulationRepulsion={0.6}
            onNodeClick={(n) => setSelected(n || null)}
          />
        </CosmographProvider>

        {/* Node detail card */}
        {selectedNode && (
          <div style={{
            position: "absolute", right: 20, top: 20, width: 320, padding: 16,
            background: "rgba(17,17,28,0.96)", border: "1px solid #2a2a3e",
            borderRadius: 8, backdropFilter: "blur(8px)", zIndex: 10,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{
                fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2,
                color: KIND_COLORS[selectedNode.kind] || "#888", fontWeight: 600,
              }}>
                {selectedNode.kind}
              </span>
              <button onClick={() => setSelected(null)} style={closeBtnStyle}>×</button>
            </div>
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.55, color: "#d0d0e0" }}>
              {selectedNode.preview}
              {selectedNode.preview?.length >= 140 && <span style={{ color: "#555" }}> …</span>}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: "#666", lineHeight: 1.7 }}>
              <span style={{ color: "#888" }}>project</span> {selectedNode.project}<br />
              <span style={{ color: "#888" }}>recalled</span> {selectedNode.access_count || 0}×<br />
              <span style={{ color: "#888" }}>filed</span>{" "}
              {new Date(selectedNode.created_at * 1000).toLocaleString()}
              {selectedNode.tags && (
                <><br /><span style={{ color: "#888" }}>tags</span> {selectedNode.tags}</>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn onClick={deleteNode} danger>Delete from archive</Btn>
            </div>
          </div>
        )}

        {/* Empty state */}
        {visible.nodes.length === 0 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            color: "#444", pointerEvents: "none",
          }}>
            <div style={{ fontSize: 13, maxWidth: 320, textAlign: "center", lineHeight: 1.6 }}>
              Vex's archive is empty for this view.
              <br />
              Use the MCP <code style={{ color: "#666" }}>remember</code> tool to start filing memories.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children, title }) {
  return (
    <div title={title} style={{
      fontSize: 10, textTransform: "uppercase", letterSpacing: 1.1,
      color: "#666", marginBottom: 6, fontWeight: 600,
    }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, active, danger, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: "8px 12px", border: "1px solid",
      borderColor: active ? "#5b9dff" : "#252535",
      background:  active ? "rgba(91,157,255,0.18)" : "#16162a",
      color:       danger  ? "#ff6b6b" : "#c8c8dc",
      borderRadius: 6, cursor: "pointer", fontSize: 12, flex: 1,
    }}>
      {children}
    </button>
  );
}

function Legend({ heatMode }) {
  if (heatMode) {
    return (
      <div>
        <Label title="Brighter = recalled more often">Heat (recall frequency)</Label>
        <div style={{ height: 10, borderRadius: 5, background: "linear-gradient(to right, #2a3050, #ff6b3d)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", marginTop: 4 }}>
          <span>cold</span><span>hot</span>
        </div>
      </div>
    );
  }
  return (
    <div>
      <Label>Kinds</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "#aaa" }}>
        {Object.entries(KIND_COLORS).map(([k, c]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, flexShrink: 0 }} />
            {k}
          </div>
        ))}
        <div style={{ borderTop: "1px solid #1e1e2e", marginTop: 4, paddingTop: 6 }}>
          <Label>Edges</Label>
          {[
            ["semantic", EDGE_COLORS.semantic, "cosine sim > 0.75"],
            ["explicit", EDGE_COLORS.explicit, "related_to tag"],
            ["temporal", EDGE_COLORS.temporal, "sequential filing"],
          ].map(([k, c, tip]) => (
            <div key={k} title={tip} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 18, height: 2, background: c, flexShrink: 0, borderRadius: 1 }} />
              {k}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const selectStyle = {
  width: "100%", padding: "7px 10px", background: "#16162a",
  color: "#c8c8dc", border: "1px solid #252535", borderRadius: 6,
  fontSize: 12, outline: "none", cursor: "pointer",
};

const closeBtnStyle = {
  background: "none", border: "none", color: "#666",
  fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0,
};
