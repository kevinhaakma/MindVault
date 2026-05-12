// Shared style tokens + tiny presentational primitives.

export const inputStyle = {
  width: "100%", padding: "8px 11px", boxSizing: "border-box",
  background: "#0e0e1e", color: "#d8d8f0",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 6, fontSize: 12, outline: "none", resize: "vertical",
  transition: "border-color 0.15s",
};

export const pillStyle = {
  padding: "6px 12px", borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "transparent", color: "#777",
  fontSize: 11, fontWeight: 600, cursor: "pointer",
  transition: "all 0.15s",
};

export const pillActive = {
  background: "rgba(91,157,255,0.15)", color: "#5b9dff",
  borderColor: "rgba(91,157,255,0.4)",
};

export const closeBtnStyle = {
  background: "none", border: "none", color: "#666",
  fontSize: 24, cursor: "pointer", lineHeight: 1,
  padding: 0, width: 24, height: 24,
};

export function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div className="num-mono" style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{
        fontSize: 9, color: "#555", textTransform: "uppercase",
        letterSpacing: 1.4, marginTop: 4, fontWeight: 600,
      }}>{label}</div>
    </div>
  );
}

export function Row({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: "#555", minWidth: 60, textTransform: "uppercase", fontSize: 10, letterSpacing: 1 }}>{label}</span>
      <span style={{ color: "#aaa", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

export function Label({ children }) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", letterSpacing: 1.1,
      color: "#555", marginBottom: 6, fontWeight: 700,
    }}>{children}</div>
  );
}

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2,
        color: "#666", marginBottom: 7, fontWeight: 700,
      }}>{label}</div>
      {children}
    </div>
  );
}

export function Btn({ children, onClick, active, danger, type }) {
  return (
    <button type={type || "button"} onClick={onClick} style={{
      padding: "8px 12px", border: "1px solid",
      borderColor: danger ? "rgba(255,107,107,0.3)" : active ? "#5b9dff" : "rgba(255,255,255,0.07)",
      background:  danger ? "rgba(255,107,107,0.08)" : active ? "rgba(91,157,255,0.18)" : "rgba(255,255,255,0.03)",
      color:       danger ? "#ff8888" : active ? "#5b9dff" : "#c8c8dc",
      borderRadius: 6, cursor: "pointer", fontSize: 12, flex: 1, fontWeight: 500,
      transition: "all 0.15s",
    }}>{children}</button>
  );
}

export function ZoomBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 28, height: 28, border: "none", background: "transparent",
      color: "#aaa", fontSize: 16, cursor: "pointer", borderRadius: 4,
    }}>{children}</button>
  );
}
