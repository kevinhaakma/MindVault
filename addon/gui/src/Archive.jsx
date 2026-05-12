import { useMemo, useState } from "react";
import { KIND_COLORS } from "./constants.js";
import { timeAgo } from "./utils.js";
import { pillStyle, pillActive } from "./ui.jsx";

export function Archive({ nodes, onSelect, selectedId }) {
  const [sort, setSort] = useState("recent");
  const sorted = useMemo(() => {
    const arr = [...nodes];
    if (sort === "recent") arr.sort((a, b) => b.created_at - a.created_at);
    if (sort === "hot")    arr.sort((a, b) => (b.access_count || 0) - (a.access_count || 0));
    if (sort === "kind")   arr.sort((a, b) => (a.kind || "").localeCompare(b.kind || ""));
    return arr;
  }, [nodes, sort]);

  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "24px 32px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ margin: 0, color: "#e0e0f0", fontWeight: 700, fontSize: 22, letterSpacing: 0.3 }}>
            Archive
            <span style={{ color: "#555", fontSize: 14, fontWeight: 400, marginLeft: 10 }}>
              {nodes.length} memor{nodes.length === 1 ? "y" : "ies"}
            </span>
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            {[["recent", "Newest"], ["hot", "Most recalled"], ["kind", "By kind"]].map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)}
                style={{ ...pillStyle, ...(sort === k ? pillActive : null) }}
              >{l}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {sorted.map(n => (
            <ArchiveRow key={n.id} n={n} selected={selectedId === n.id} onClick={() => onSelect(n)} />
          ))}
        </div>

        {!nodes.length && (
          <div style={{ color: "#444", textAlign: "center", padding: 60 }}>
            No memories to display.
          </div>
        )}
      </div>
    </div>
  );
}

function ArchiveRow({ n, selected, onClick }) {
  return (
    <div onClick={onClick} style={{
      padding: "14px 16px", borderRadius: 8, cursor: "pointer",
      background: selected ? "rgba(91,157,255,0.1)" : "rgba(255,255,255,0.025)",
      border: `1px solid ${selected ? "rgba(91,157,255,0.4)" : "rgba(255,255,255,0.05)"}`,
      transition: "all 0.15s",
    }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(91,157,255,0.3)"}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = selected
        ? "rgba(91,157,255,0.4)" : "rgba(255,255,255,0.05)"}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: KIND_COLORS[n.kind] || "#888",
          boxShadow: `0 0 6px ${KIND_COLORS[n.kind] || "#888"}`,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10, textTransform: "uppercase", letterSpacing: 1.1,
          color: KIND_COLORS[n.kind] || "#888", fontWeight: 700,
        }}>{n.kind}</span>
        <span style={{ fontSize: 11, color: "#555" }}>·</span>
        <span style={{ fontSize: 11, color: "#777" }}>{n.project}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#444" }}>
          {timeAgo(n.created_at * 1000)} {n.access_count > 0 && `· recalled ${n.access_count}×`}
        </span>
      </div>
      <div style={{ color: "#c8c8dc", fontSize: 13, lineHeight: 1.5 }}>{n.preview}</div>
      {n.tags && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {n.tags.split(",").filter(Boolean).map(t => (
            <span key={t} style={{
              fontSize: 10, padding: "2px 7px", borderRadius: 10,
              background: "rgba(255,255,255,0.04)", color: "#888",
              border: "1px solid rgba(255,255,255,0.05)",
            }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
