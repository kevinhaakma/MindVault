import { ENTITY_KIND_COLORS, KIND_COLORS, predicateColor } from "./constants.js";
import { closeBtnStyle } from "./ui.jsx";

export function EntityPanel({ entityProfile, onClose, onPickMemory }) {
  if (!entityProfile) return null;
  const e = entityProfile.entity;
  const color = ENTITY_KIND_COLORS[e.kind] || "#888";
  const outgoing = entityProfile.triples.filter(t => t.subj_id === e.id);
  const incoming = entityProfile.triples.filter(t => t.obj_id === e.id);

  return (
    <>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, zIndex: 9,
        background: "rgba(0,0,0,0.15)", animation: "fadeIn 0.18s ease",
      }} />
      <div onClick={(ev) => ev.stopPropagation()} style={{
        position: "absolute", right: 20, top: 20, width: 400, maxHeight: "calc(100vh - 40px)",
        overflowY: "auto", padding: 20,
        background: "rgba(10,10,20,0.97)",
        border: `1px solid ${color}33`,
        borderRadius: 14, backdropFilter: "blur(20px)",
        boxShadow: "0 16px 56px rgba(0,0,0,0.75)", zIndex: 10,
        animation: "slideIn 0.22s cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 12, height: 12, borderRadius: "50%",
            background: color, boxShadow: `0 0 10px ${color}`,
          }} />
          <span style={{ fontSize: 16, fontWeight: 800, color: "#e6e6f0" }}>{e.name}</span>
          <span style={{
            marginLeft: "auto", fontSize: 9, color: "#666",
            letterSpacing: 1.2, textTransform: "uppercase",
          }}>{e.kind || "entity"}</span>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={{
          padding: "8px 12px", borderRadius: 6, marginBottom: 14,
          background: "rgba(255,255,255,0.025)",
          fontSize: 11, color: "#777", display: "flex", gap: 14,
        }}>
          <span><b style={{ color: "#aaa" }}>{e.mention_count}</b> mentions</span>
          <span><b style={{ color: "#aaa" }}>{entityProfile.triples.length}</b> triples</span>
          <span><b style={{ color: "#aaa" }}>{entityProfile.memories.length}</b> memories</span>
        </div>

        {outgoing.length > 0 && (
          <TripleList title="Outgoing" items={outgoing} names={entityProfile.names} direction="out" />
        )}
        {incoming.length > 0 && (
          <TripleList title="Incoming" items={incoming} names={entityProfile.names} direction="in" />
        )}

        {entityProfile.memories.length > 0 && (
          <div>
            <SectionLabel>From {entityProfile.memories.length} memor{entityProfile.memories.length === 1 ? "y" : "ies"}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {entityProfile.memories.map(m => (
                <div key={m.id} onClick={() => onPickMemory(m)} style={{
                  padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: KIND_COLORS[m.kind] || "#888",
                    }} />
                    <span style={{
                      fontSize: 9, textTransform: "uppercase", letterSpacing: 1,
                      color: KIND_COLORS[m.kind] || "#888", fontWeight: 700,
                    }}>{m.kind}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "#555" }}>{m.project}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#c8c8dc", lineHeight: 1.4 }}>
                    {(m.content || "").slice(0, 140)}{(m.content || "").length > 140 ? "…" : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", letterSpacing: 1.3,
      color: "#666", marginBottom: 7, fontWeight: 700,
    }}>{children}</div>
  );
}

function TripleList({ title, items, names, direction }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((t, i) => (
          <div key={i} style={{
            padding: "6px 10px", borderRadius: 5,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.04)",
            fontSize: 11, color: "#c8c8dc", lineHeight: 1.4,
            display: "flex", gap: 8, alignItems: "center",
          }}>
            <span style={{
              width: 14, height: 2, background: predicateColor(t.predicate),
              flexShrink: 0, borderRadius: 1,
            }} />
            {direction === "out" ? (
              <>
                <span style={{ color: "#7ab8ff", fontWeight: 600 }}>{t.predicate}</span>
                <span style={{ color: "#999" }}>
                  {t.obj_id ? names[t.obj_id]?.name : `"${t.obj_literal}"`}
                </span>
              </>
            ) : (
              <>
                <span style={{ color: "#aaa" }}>{names[t.subj_id]?.name}</span>
                <span style={{ color: "#666" }}>—</span>
                <span style={{ color: "#7ab8ff", fontWeight: 600 }}>{t.predicate}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
