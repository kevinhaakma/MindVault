import { useState } from "react";
import { KIND_COLORS } from "./constants.js";
import { Field, inputStyle } from "./ui.jsx";

export function FileForm({ projects, onWrote, vexSay }) {
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
        method: "POST",
        headers: { "content-type": "application/json" },
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
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "32px" }}>
      <form onSubmit={submit} style={{ maxWidth: 680, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 6px", color: "#e0e0f0", fontWeight: 700, fontSize: 22 }}>
          File a memory
        </h2>
        <p style={{ color: "#555", margin: "0 0 24px", fontSize: 13 }}>
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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
            <div style={{ display: "flex", gap: 6 }}>
              {Object.keys(KIND_COLORS).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)} style={{
                  flex: 1, padding: "8px 4px", borderRadius: 6,
                  border: `1px solid ${kind === k ? KIND_COLORS[k] : "rgba(255,255,255,0.08)"}`,
                  background: kind === k ? `${KIND_COLORS[k]}22` : "rgba(255,255,255,0.02)",
                  color: kind === k ? KIND_COLORS[k] : "#888",
                  fontSize: 11, cursor: "pointer", fontWeight: 600, textTransform: "capitalize",
                }}>{k}</button>
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
            padding: "10px 14px", borderRadius: 6, marginBottom: 14,
            background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)",
            color: "#ff8888", fontSize: 12,
          }}>{error}</div>
        )}

        <button type="submit" disabled={submitting || !content.trim()} style={{
          width: "100%", padding: "12px", borderRadius: 6,
          background: submitting ? "#1a2840" : "linear-gradient(90deg, #5b9dff, #7eb4ff)",
          color: "#fff", border: "none", fontWeight: 700, fontSize: 13,
          cursor: submitting || !content.trim() ? "not-allowed" : "pointer",
          opacity: !content.trim() ? 0.5 : 1,
          transition: "all 0.15s",
        }}>
          {submitting ? "Filing…" : "File memory →"}
        </button>
      </form>
    </div>
  );
}
