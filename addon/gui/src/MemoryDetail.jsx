import { KIND_COLORS } from "./constants.js";
import { fmtDate, livenessOf, timeAgo } from "./utils.js";
import { Btn, Row, closeBtnStyle } from "./ui.jsx";

export function MemoryDetail({ memory, related, onClose, onPickRelated, onDelete }) {
  if (!memory) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, zIndex: 9,
        background: "rgba(0,0,0,0.15)",
        animation: "fadeIn 0.18s ease",
      }} />
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "absolute", right: 20, top: 20, width: 380, maxHeight: "calc(100vh - 40px)",
        overflowY: "auto", padding: 20,
        background: "rgba(10,10,20,0.97)",
        border: `1px solid ${KIND_COLORS[memory.kind] || "#5b9dff"}33`,
        borderRadius: 14, backdropFilter: "blur(20px)",
        boxShadow: "0 16px 56px rgba(0,0,0,0.75)", zIndex: 10,
        animation: "slideIn 0.22s cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: KIND_COLORS[memory.kind] || "#888",
              boxShadow: `0 0 8px ${KIND_COLORS[memory.kind] || "#888"}`,
            }} />
            <span style={{
              fontSize: 10, textTransform: "uppercase", letterSpacing: 1.3,
              color: KIND_COLORS[memory.kind] || "#888", fontWeight: 700,
            }}>{memory.kind}</span>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={{
          fontSize: 13, lineHeight: 1.7, color: "#d8d8f0", whiteSpace: "pre-wrap",
          maxHeight: 240, overflowY: "auto", marginBottom: 14, paddingRight: 6,
        }}>{memory.content}</div>

        <div style={{
          padding: "10px 12px", borderRadius: 6,
          background: "rgba(255,255,255,0.025)",
          fontSize: 11, color: "#666", lineHeight: 2, marginBottom: 14,
        }}>
          <Row label="project"  value={memory.project} />
          <Row label="recalled" value={`${memory.access_count || 0}×${memory.last_accessed ? ` · last ${timeAgo(memory.last_accessed * 1000)}` : ""}`} />
          <Row label="filed"    value={`${fmtDate(memory.created_at)} · ${timeAgo(memory.created_at * 1000)}`} />
          <Row label="liveness" value={(livenessOf(memory) * 100).toFixed(0) + "%"} />
          {memory.tags && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>tags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {memory.tags.split(",").filter(Boolean).map(t => (
                  <span key={t} style={{
                    fontSize: 10, padding: "2px 7px", borderRadius: 10,
                    background: "rgba(91,157,255,0.08)", color: "#8db4ff",
                    border: "1px solid rgba(91,157,255,0.15)",
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {related?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2,
              color: "#555", marginBottom: 8, fontWeight: 700,
            }}>Related ({related.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {related.map(r => (
                <div key={r.id} onClick={() => onPickRelated(r.node)} style={{
                  padding: "7px 10px", borderRadius: 5, cursor: "pointer",
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  display: "flex", gap: 8, alignItems: "center",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: KIND_COLORS[r.node.kind] || "#888",
                  }} />
                  <span style={{
                    fontSize: 11, color: "#aaa", flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.node.preview?.slice(0, 50)}</span>
                  <span style={{ fontSize: 9, color: "#555", textTransform: "uppercase" }}>{r.kind}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Btn onClick={onDelete} danger>Delete from archive</Btn>
      </div>
    </>
  );
}
