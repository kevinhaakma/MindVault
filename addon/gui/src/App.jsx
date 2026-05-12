import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthGate } from "./AuthGate.jsx";
import { Starfield } from "./Starfield.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { KnowledgeView } from "./KnowledgeView.jsx";
import { EntityPanel } from "./EntityPanel.jsx";
import { MemoryDetail } from "./MemoryDetail.jsx";
import { Archive } from "./Archive.jsx";
import { FileForm } from "./FileForm.jsx";
import { closeBtnStyle } from "./ui.jsx";

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return <AuthGate><MindVaultApp /></AuthGate>;
}

// ── Orchestration only ──────────────────────────────────────────────────────
function MindVaultApp() {
  // State
  const [archiveOpen,     setArchiveOpen]     = useState(false);
  const [fileOpen,        setFileOpen]        = useState(false);
  const [graph,           setGraph]           = useState({ nodes: [], edges: [] });
  const [knowledge,       setKnowledge]       = useState({ nodes: [], edges: [], literals: [] });
  const [kindFilter,      setKindFilter]      = useState(new Set());
  const [predicateFilter, setPredicateFilter] = useState(new Set());
  const [selectedEntity,  setSelectedEntity]  = useState(null);
  const [entityProfile,   setEntityProfile]   = useState(null);
  const [projects,        setProjects]        = useState([]);
  const [selected,        setSelected]        = useState(null);
  const [fullMemory,      setFullMemory]      = useState(null);
  const [stats,           setStats]           = useState(null);
  const [version,         setVersion]         = useState(null);
  const [search,          setSearch]          = useState("");
  const [smartResults,    setSmartResults]    = useState(null);
  const [vexMood,         setVexMood]         = useState("neutral");
  const [hoverId,         setHoverId]         = useState(null);
  const [lastUpdated,     setLastUpdated]     = useState(null);
  const moodTimer = useRef(null);
  const sidebarRef = useRef(null);

  const vexSay = useCallback((mood, ms = 2500) => {
    setVexMood(mood);
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setVexMood("neutral"), ms);
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────
  const lastHashRef = useRef({ m: -1, e: -1 });

  const fetchGraph = useCallback(async () => {
    try {
      const g = await fetch("/api/graph").then(r => r.json());
      setGraph(g);
      setLastUpdated(Date.now());
    } catch {}
  }, []);

  const tick = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetch("/api/stats").then(r => r.json()),
        fetch("/api/health").then(r => r.json()).catch(() => ({})),
      ]);
      setStats(s);
      setProjects(s.projects || []);
      setVersion(h.version || null);
      const ms = s.memories ?? 0;
      const es = s.edges ?? 0;
      if (ms !== lastHashRef.current.m || es !== lastHashRef.current.e) {
        lastHashRef.current = { m: ms, e: es };
        await fetchGraph();
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

  useEffect(() => { lastHashRef.current = { m: -1, e: -1 }; tick(); }, [tick]);
  useEffect(() => { const id = setInterval(tick, 2000); return () => clearInterval(id); }, [tick]);

  // ── Smart memory search (entity search is local — see entityMatches below) ──
  useEffect(() => {
    if (!search || search.length < 3) { setSmartResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/recall", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: search, mode: "smart", limit: 20, include_neighbors: false,
          }),
        }).then(r => r.json());
        const m = {};
        (r.results || []).forEach(it => { m[it.id] = it.score; });
        setSmartResults(m);
      } catch { setSmartResults(null); }
    }, 220);
    return () => clearTimeout(t);
  }, [search]);

  // ── Memory selection → fetch full content ──────────────────────────────
  useEffect(() => {
    if (!selected) { setFullMemory(null); return; }
    fetch(`/api/memory/${selected.id}`).then(r => r.json()).then(setFullMemory).catch(() => {});
  }, [selected]);

  // ── Entity selection → fetch profile ───────────────────────────────────
  useEffect(() => {
    if (!selectedEntity) { setEntityProfile(null); return; }
    fetch(`/api/entity/${selectedEntity.id}`).then(r => r.json()).then(setEntityProfile).catch(() => {});
  }, [selectedEntity]);

  // ── Derived ────────────────────────────────────────────────────────────
  const entityMatches = useMemo(() => {
    if (!search) return new Set();
    const q = search.toLowerCase();
    return new Set(
      knowledge.nodes
        .filter(n => (n.name || "").toLowerCase().includes(q) || (n.canonical || "").includes(q))
        .map(n => n.id)
    );
  }, [search, knowledge.nodes]);

  const related = useMemo(() => {
    if (!selected) return [];
    const rel = graph.edges
      .filter(e => e.src === selected.id || e.dst === selected.id)
      .map(e => ({ id: e.src === selected.id ? e.dst : e.src, kind: e.kind, weight: e.weight }))
      .sort((a, b) => b.weight - a.weight);
    const seen = new Set();
    return rel.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map(r => ({ ...r, node: graph.nodes.find(n => n.id === r.id) }))
      .filter(r => r.node)
      .slice(0, 8);
  }, [selected, graph]);

  // memories visible in Archive — filtered by search via memory `preview` substring or smart results
  const archiveMemories = useMemo(() => {
    if (!search) return graph.nodes;
    const q = search.toLowerCase();
    const subset = new Set(
      graph.nodes
        .filter(n =>
          n.preview?.toLowerCase().includes(q) ||
          n.tags?.toLowerCase().includes(q) ||
          n.kind?.includes(q) ||
          n.project?.toLowerCase().includes(q)
        )
        .map(n => n.id)
    );
    if (smartResults) Object.keys(smartResults).forEach(id => subset.add(id));
    return graph.nodes.filter(n => subset.has(n.id));
  }, [graph.nodes, search, smartResults]);

  // ── Actions ────────────────────────────────────────────────────────────
  const deleteSelected = async () => {
    if (!selected) return;
    if (!confirm("Delete this memory? This cannot be undone.")) return;
    await fetch(`/api/memory/${selected.id}`, { method: "DELETE" });
    setSelected(null); setFullMemory(null);
    lastHashRef.current = { m: -1, e: -1 };
    tick();
    vexSay("thumbsup");
  };

  const pruneOrphans = async () => {
    if (!confirm("Delete orphans — memories with no edges and never recalled?")) return;
    const r = await fetch("/api/prune-orphans", { method: "POST" }).then(r => r.json());
    alert(`Vex pruned ${r.count} orphan${r.count === 1 ? "" : "s"}.`);
    lastHashRef.current = { m: -1, e: -1 };
    tick();
  };

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  };

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (fileOpen)             setFileOpen(false);
        else if (archiveOpen)     setArchiveOpen(false);
        else if (selectedEntity)  setSelectedEntity(null);
        else if (selected || fullMemory) { setSelected(null); setFullMemory(null); }
        else if (search)          setSearch("");
        else if (inField)         t.blur();
        return;
      }
      if (inField) return;
      if (e.key === "/") { e.preventDefault(); sidebarRef.current?.focusSearch(); }
      else if (e.key === "n") setFileOpen(true);
      else if (e.key === "a") setArchiveOpen(true);
      else if (e.key === "r" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); tick(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, fullMemory, selectedEntity, search, fileOpen, archiveOpen, tick]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", height: "100vh", overflow: "hidden",
      fontFamily: "'Inter','Segoe UI',sans-serif",
      background:
        "radial-gradient(ellipse at 25% 15%, rgba(91,157,255,0.07), transparent 55%)," +
        "radial-gradient(ellipse at 80% 90%, rgba(184,107,255,0.06), transparent 60%)," +
        "#070710",
      color: "#c8c8dc",
    }}>
      <Sidebar ref={sidebarRef}
        version={version}
        stats={stats}
        knowledge={knowledge}
        search={search}
        setSearch={setSearch}
        entityMatchesSize={entityMatches.size}
        smartResultsSize={smartResults ? Object.keys(smartResults).length : 0}
        kindFilter={kindFilter}
        setKindFilter={setKindFilter}
        predicateFilter={predicateFilter}
        setPredicateFilter={setPredicateFilter}
        vexMood={vexMood}
        lastUpdated={lastUpdated}
        onOpenFile={() => setFileOpen(true)}
        onOpenArchive={() => setArchiveOpen(true)}
        onPruneOrphans={pruneOrphans}
        onSignOut={signOut}
      />

      <main style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <Starfield />

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

        {fileOpen && (
          <FileModal
            projects={projects}
            onClose={() => setFileOpen(false)}
            onWrote={() => { lastHashRef.current = { m: -1, e: -1 }; tick(); setFileOpen(false); }}
            vexSay={vexSay}
          />
        )}

        {archiveOpen && (
          <ArchiveDrawer
            memories={archiveMemories}
            searching={!!search}
            selectedId={selected?.id}
            onClose={() => setArchiveOpen(false)}
            onPick={(m) => { setSelected(m); setArchiveOpen(false); }}
          />
        )}

        {selectedEntity && entityProfile && (
          <EntityPanel
            entityProfile={entityProfile}
            onClose={() => setSelectedEntity(null)}
            onPickMemory={(m) => { setSelectedEntity(null); setSelected(m); }}
          />
        )}

        {fullMemory && (
          <MemoryDetail
            memory={fullMemory}
            related={related}
            onClose={() => { setSelected(null); setFullMemory(null); }}
            onPickRelated={(node) => setSelected(node)}
            onDelete={deleteSelected}
          />
        )}
      </main>
    </div>
  );
}

// ── Small overlay containers (kept close to App, since they wire to its state) ─
function FileModal({ projects, onClose, onWrote, vexSay }) {
  return (
    <>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, zIndex: 20,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)",
        animation: "fadeIn 0.18s ease",
      }} />
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        width: 540, maxHeight: "85vh", zIndex: 21,
        background: "rgba(10,10,20,0.97)",
        border: "1px solid rgba(91,157,255,0.25)",
        borderRadius: 14, backdropFilter: "blur(20px)",
        boxShadow: "0 20px 80px rgba(0,0,0,0.8)",
        overflow: "hidden", animation: "slideIn 0.22s cubic-bezier(.2,.8,.2,1)",
      }}>
        <button onClick={onClose} style={{
          position: "absolute", right: 12, top: 12, zIndex: 1,
          ...closeBtnStyle,
        }}>×</button>
        <FileForm projects={projects} onWrote={onWrote} vexSay={vexSay} />
      </div>
    </>
  );
}

function ArchiveDrawer({ memories, searching, selectedId, onClose, onPick }) {
  return (
    <>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, zIndex: 18,
        background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)",
        animation: "fadeIn 0.18s ease",
      }} />
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: "min(640px, 80vw)",
        zIndex: 19,
        background: "rgba(10,10,20,0.98)",
        borderLeft: "1px solid rgba(91,157,255,0.2)",
        backdropFilter: "blur(24px)",
        boxShadow: "-20px 0 60px rgba(0,0,0,0.7)",
        overflow: "hidden", display: "flex", flexDirection: "column",
        animation: "slideInRight 0.25s cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", padding: "16px 22px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e0e0f0" }}>Memory archive</span>
          <span style={{ marginLeft: 10, fontSize: 11, color: "#666" }}>
            {memories.length} {searching ? "match" : "memor"}
            {memories.length === 1 ? (searching ? "" : "y") : (searching ? "es" : "ies")}
          </span>
          <button onClick={onClose} style={{ marginLeft: "auto", ...closeBtnStyle }}>×</button>
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <Archive nodes={memories} onSelect={onPick} selectedId={selectedId} />
        </div>
      </div>
    </>
  );
}
