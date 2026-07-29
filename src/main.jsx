import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./shell/ErrorBoundary.jsx";
import "./styles.css";

// No viewport bootstrapping here any more. The frame measures visualViewport
// inside App, where React can re-render on every change — the keyboard, the
// letterbox and rotation all move that number, and a value read once at boot
// is wrong within seconds.

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
