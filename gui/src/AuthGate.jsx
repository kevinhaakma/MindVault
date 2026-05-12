import { useCallback, useEffect, useRef, useState } from "react";
import { Starfield } from "./Starfield.jsx";
import { Field, inputStyle } from "./ui.jsx";

function LoginScreen({ onSuccess }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!pw) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) throw new Error(r.status === 401 ? "Wrong password" : `Error ${r.status}`);
      onSuccess();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background:
        "radial-gradient(circle at 30% 20%, rgba(91,157,255,0.12), transparent 50%)," +
        "radial-gradient(circle at 70% 80%, rgba(184,107,255,0.10), transparent 55%)," +
        "#070710",
      fontFamily: "'Inter','Segoe UI',sans-serif",
      overflow: "hidden",
    }}>
      <Starfield />
      <form onSubmit={submit} style={{
        position: "relative", zIndex: 1,
        width: 340, padding: "32px 30px",
        background: "rgba(12,12,22,0.78)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        backdropFilter: "blur(24px)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(91,157,255,0.08) inset",
        animation: "slideIn 0.35s cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{
            width: 54, height: 54, borderRadius: "50%",
            background: "linear-gradient(135deg, #5b9dff, #b86bff)",
            boxShadow: "0 0 28px rgba(91,157,255,0.55), 0 0 60px rgba(184,107,255,0.25)",
            marginBottom: 14,
          }} />
          <div style={{
            fontSize: 22, fontWeight: 800, letterSpacing: 0.3,
            background: "linear-gradient(90deg, #c8d8ff, #e6d5ff)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text", color: "transparent",
          }}>MindVault</div>
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.8, textTransform: "uppercase", marginTop: 3 }}>
            Vex · Memory Archive
          </div>
        </div>

        <Field label="Password">
          <input
            ref={ref}
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            style={{ ...inputStyle, padding: "11px 14px", fontSize: 14, letterSpacing: 1 }}
          />
        </Field>

        {err && (
          <div style={{
            padding: "9px 12px", borderRadius: 6, marginBottom: 14,
            background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)",
            color: "#ff8888", fontSize: 12,
          }}>{err}</div>
        )}

        <button type="submit" disabled={busy || !pw}
          style={{
            width: "100%", padding: "12px", borderRadius: 8,
            background: busy || !pw ? "rgba(91,157,255,0.18)"
                                    : "linear-gradient(90deg, #5b9dff, #b86bff)",
            color: "#fff", border: "none", fontWeight: 700, fontSize: 13,
            letterSpacing: 0.5,
            cursor: busy || !pw ? "not-allowed" : "pointer",
            transition: "all 0.15s",
            boxShadow: busy || !pw ? "none" : "0 6px 20px rgba(91,157,255,0.4)",
          }}
        >{busy ? "Unlocking…" : "Enter"}</button>

        <div style={{
          marginTop: 18, fontSize: 9, color: "#444", textAlign: "center", letterSpacing: 1.2,
        }}>VEX IS WATCHING</div>
      </form>
    </div>
  );
}

export function AuthGate({ children }) {
  const [state, setState] = useState({ loading: true, authed: false, required: false });
  const check = useCallback(() => fetch("/api/me", { credentials: "include" })
    .then(r => r.json())
    .then(d => setState({ loading: false, authed: !!d.authenticated, required: !!d.auth_required }))
    .catch(() => setState({ loading: false, authed: false, required: true })),
  []);
  useEffect(() => { check(); }, [check]);
  if (state.loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#070710", color: "#444",
        fontFamily: "'Inter',sans-serif", fontSize: 11, letterSpacing: 1.5,
      }}>LOADING…</div>
    );
  }
  if (state.required && !state.authed) return <LoginScreen onSuccess={check} />;
  return children;
}
