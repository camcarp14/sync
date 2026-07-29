import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./shell/ErrorBoundary.jsx";
import { installViewport } from "./shell/viewport.js";
import "./styles.css";

// Before React mounts: the layout reads --safe-top / --safe-bottom / --app-h,
// and they must exist for the first paint, not arrive after it.
installViewport();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
