import { Component } from "react";

// A crash must not cost the user their day. The boundary shows what happened,
// offers a reload, and — critically — a way to export state before anything
// else is touched, because everything SYNC knows lives in this browser.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No telemetry service to phone home to; the console is the record.
    console.error("SYNC crashed:", error, info?.componentStack);
  }

  download = () => {
    try {
      const raw = localStorage.getItem("sync.state.v1") || "{}";
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `sync-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* storage is gone; nothing to save */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card pad-lg" style={{ maxWidth: 460, width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="t-title2">SYNC hit an error</div>
          <div className="t-body" style={{ color: "var(--sub)" }}>
            Your day is still saved in this browser — nothing was lost. Reloading fixes almost all of these.
          </div>
          <code
            className="t-mono"
            style={{ fontSize: 12, color: "var(--red)", background: "var(--ink-a05)", padding: "10px 12px", borderRadius: 10, overflowWrap: "anywhere" }}
          >
            {String(this.state.error?.message || this.state.error)}
          </code>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn primary md" style={{ flex: 1 }} onClick={() => window.location.reload()}>Reload</button>
            <button className="btn quiet md" onClick={this.download}>Save a backup</button>
          </div>
        </div>
      </div>
    );
  }
}
