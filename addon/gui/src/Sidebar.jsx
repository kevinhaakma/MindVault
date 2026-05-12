import { useRef, useImperativeHandle, forwardRef } from "react";
import { VexAvatar } from "./VexAvatar.jsx";
import {
  ENTITY_KIND_COLORS, PREDICATE_GROUPS,
} from "./constants.js";
import { timeAgo } from "./utils.js";
import { Stat, Label, Btn, inputStyle } from "./ui.jsx";

export const Sidebar = forwardRef(function Sidebar({
  version, stats, knowledge,
  search, setSearch,
  entityMatchesSize, smartResultsSize,
  kindFilter, setKindFilter,
  predicateFilter, setPredicateFilter,
  minMention, setMinMention,
  vexMood, lastUpdated,
  onOpenFile, onOpenArchive, onPruneOrphans, onSignOut,
}, ref) {
  const searchRef = useRef(null);
  useImperativeHandle(ref, () => ({
    focusSearch: () => searchRef.current?.focus(),
  }));

  return (
    <aside style={{
      width: 280, flexShrink: 0, padding: "20px 16px",
      display: "flex", flexDirection: "column", gap: 16, overflowY: "auto",
      background: "rgba(10,10,20,0.85)", backdropFilter: "blur(14px)",
      borderRight: "1px solid rgba(255,255,255,0.06)",
      boxShadow: "4px 0 32px rgba(0,0,0,0.5)", zIndex: 5,
    }}>
      <Brand version={version} />

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <button onClick={onOpenFile} style={{
          padding: "11px 14px", borderRadius: 9, border: "none", cursor: "pointer",
          background: "linear-gradient(135deg, rgba(91,157,255,0.22), rgba(184,107,255,0.18))",
          color: "#e0eaff", fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
          boxShadow: "0 4px 16px rgba(91,157,255,0.18), 0 0 0 1px rgba(91,157,255,0.15) inset",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1, color: "#a5c4ff" }}>＋</span>
          File memory
          <span className="kbd" style={{ marginLeft: "auto", fontSize: 9 }}>n</span>
        </button>
        <button onClick={onOpenArchive} style={{
          padding: "9px 14px", borderRadius: 9, cursor: "pointer",
          background: "rgba(255,255,255,0.04)",
          color: "#aab", fontSize: 11, fontWeight: 600,
          border: "1px solid rgba(255,255,255,0.06)", letterSpacing: 0.3,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 13, color: "#888" }}>⬚</span>
          Browse <span className="num-mono" style={{ color: "#cfe0ff", fontWeight: 700 }}>{stats?.memories ?? 0}</span> memories
          <span className="kbd" style={{ marginLeft: "auto", fontSize: 9 }}>a</span>
        </button>
      </div>

      <div className="card-accent" style={{
        display: "flex", padding: "14px 4px", borderRadius: 10,
        background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))",
        border: "1px solid rgba(255,255,255,0.05)",
      }}>
        <Stat label="entities" value={stats?.entities ?? 0} color="#7ee787" />
        <div style={{ width: 1, background: "rgba(255,255,255,0.05)", margin: "4px 0" }} />
        <Stat label="triples"  value={stats?.triples ?? 0}  color="#b86bff" />
        <div style={{ width: 1, background: "rgba(255,255,255,0.05)", margin: "4px 0" }} />
        <Stat label="visible"  value={knowledge.nodes.length} color="#ffb454" />
      </div>

      <SearchBox ref={searchRef} value={search} onChange={setSearch} />

      {search && (
        <div style={{ marginTop: -10, fontSize: 10, color: "#555", lineHeight: 1.5 }}>
          {entityMatchesSize} entit{entityMatchesSize === 1 ? "y" : "ies"}
          {smartResultsSize > 0 && ` · ${smartResultsSize} memor${smartResultsSize === 1 ? "y" : "ies"}`}
        </div>
      )}

      <div>
        <Label>Density · hide entities with &lt; {minMention} mentions</Label>
        <input type="range" min="0" max="10" step="1" value={minMention}
          onChange={e => setMinMention(+e.target.value)}
          style={{ width: "100%", accentColor: "#5b9dff" }} />
      </div>

      <EntityKindFilter
        kinds={stats?.entity_kinds || []}
        filter={kindFilter}
        setFilter={setKindFilter}
      />

      <PredicateFilter filter={predicateFilter} setFilter={setPredicateFilter} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, fontSize: 10,
          padding: "7px 11px", borderRadius: 7,
          background: "rgba(126,231,135,0.04)",
          border: "1px solid rgba(126,231,135,0.12)",
        }}>
          <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 4, height: 4, borderRadius: "50%", background: "#7ee787",
                boxShadow: "0 0 4px #7ee787",
                animation: "wave-dot 1.4s ease-in-out infinite",
                animationDelay: `${i * 0.18}s`,
              }} />
            ))}
          </span>
          <span style={{ color: "#7ee787", fontWeight: 700, letterSpacing: 1.2 }}>LIVE</span>
          <span style={{
            marginLeft: "auto", color: "#444",
            fontFamily: "var(--mono)", fontSize: 9,
          }}>
            {lastUpdated ? timeAgo(lastUpdated) : "…"}
          </span>
        </div>
        <Btn onClick={onPruneOrphans} danger>Prune orphans</Btn>
      </div>

      <VexFooter mood={vexMood} onSignOut={onSignOut} />
    </aside>
  );
});

function Brand({ version }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "var(--accent-grad)",
        boxShadow: "0 0 18px rgba(91,157,255,0.55)",
        animation: "breathe 4s ease-in-out infinite",
      }} />
      <div>
        <div style={{
          fontSize: 20, fontWeight: 800, letterSpacing: -0.3,
          background: "var(--accent-text)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          backgroundClip: "text", lineHeight: 1,
        }}>MindVault</div>
        <div style={{
          fontSize: 9, color: "#555", letterSpacing: 1.6,
          textTransform: "uppercase", marginTop: 4, fontWeight: 600,
        }}>
          Vex archive {version && <span style={{ color: "#777", fontFamily: "var(--mono)" }}>· v{version}</span>}
        </div>
      </div>
    </div>
  );
}

const SearchBox = forwardRef(function SearchBox({ value, onChange }, ref) {
  return (
    <div style={{ position: "relative" }}>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search entities + memories"
        style={{
          ...inputStyle,
          paddingLeft: 30,
          paddingRight: value ? 28 : 32,
          fontSize: 12,
        }}
      />
      <span style={{
        position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
        fontSize: 13, color: "#555", pointerEvents: "none",
      }}>⌕</span>
      {value ? (
        <button onClick={() => onChange("")} style={{
          position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", color: "#666", cursor: "pointer",
          fontSize: 14, padding: "4px 6px", lineHeight: 1,
        }} title="Clear (Esc)">×</button>
      ) : (
        <span className="kbd" style={{
          position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
          fontSize: 9, pointerEvents: "none",
        }}>/</span>
      )}
    </div>
  );
});

function EntityKindFilter({ kinds, filter, setFilter }) {
  return (
    <div>
      <Label>Entity kinds</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {kinds.map(k => {
          const active = filter.has(k.kind);
          const color = ENTITY_KIND_COLORS[k.kind] || "#888";
          return (
            <button key={k.kind} onClick={() => {
              setFilter(prev => {
                const next = new Set(prev);
                if (next.has(k.kind)) next.delete(k.kind); else next.add(k.kind);
                return next;
              });
            }} style={{
              padding: "4px 9px", fontSize: 10, fontWeight: 600,
              borderRadius: 12,
              border: `1px solid ${active ? color : "rgba(255,255,255,0.06)"}`,
              background: active ? `${color}22` : "transparent",
              color: active ? color : "#888",
              cursor: "pointer", textTransform: "capitalize",
            }}>{k.kind} <span style={{ opacity: 0.55 }}>{k.count}</span></button>
          );
        })}
      </div>
      {filter.size > 0 && (
        <button onClick={() => setFilter(new Set())} style={{
          marginTop: 6, fontSize: 10, color: "#666",
          background: "none", border: "none", cursor: "pointer", padding: 0,
        }}>clear</button>
      )}
    </div>
  );
}

function PredicateFilter({ filter, setFilter }) {
  return (
    <div>
      <Label>Edge meaning</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        {PREDICATE_GROUPS.map(g => {
          const active = filter.has(g.name);
          return (
            <button key={g.name} onClick={() => {
              setFilter(prev => {
                const next = new Set(prev);
                if (next.has(g.name)) next.delete(g.name); else next.add(g.name);
                return next;
              });
            }} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "4px 6px",
              background: active ? "rgba(255,255,255,0.04)" : "transparent",
              border: "none", borderRadius: 4,
              cursor: "pointer", textAlign: "left",
              opacity: filter.size && !active ? 0.4 : 1,
            }}>
              <span style={{
                width: 18, height: 2, background: g.color,
                borderRadius: 1, flexShrink: 0,
              }} />
              <span style={{ color: active ? "#fff" : "#aaa", fontSize: 11 }}>{g.name}</span>
            </button>
          );
        })}
      </div>
      {filter.size > 0 && (
        <button onClick={() => setFilter(new Set())} style={{
          marginTop: 6, fontSize: 10, color: "#666",
          background: "none", border: "none", cursor: "pointer", padding: 0,
        }}>show all edges</button>
      )}
    </div>
  );
}

function VexFooter({ mood, onSignOut }) {
  return (
    <div style={{
      marginTop: "auto", paddingTop: 14,
      borderTop: "1px solid rgba(255,255,255,0.05)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
    }}>
      <VexAvatar mood={mood} size={46} />
      <div style={{ fontSize: 10, color: "#555", textAlign: "center", lineHeight: 1.5 }}>
        {mood === "thumbsup" && <span style={{ color: "#7ee787" }}>Filed.</span>}
        {mood === "frown"    && <span style={{ color: "#ff6b6b" }}>Something off.</span>}
        {mood === "neutral"  && "Vex is watching."}
      </div>
      <div style={{
        marginTop: 8, fontSize: 9, color: "#444",
        textAlign: "center", lineHeight: 1.7,
        display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6,
      }}>
        <span><span className="kbd">/</span> search</span>
        <span><span className="kbd">n</span> new</span>
        <span><span className="kbd">a</span> archive</span>
        <span><span className="kbd">esc</span> close</span>
      </div>
      <button onClick={onSignOut} style={{
        marginTop: 10, padding: "5px 10px", fontSize: 9,
        background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
        color: "#555", borderRadius: 6, cursor: "pointer",
        letterSpacing: 1, textTransform: "uppercase",
      }}>Sign out</button>
    </div>
  );
}
