import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { useStore } from "./state/store";

// Debug/test hook: lets automated tests and the dev console inspect app state.
(window as unknown as { __threadforge: unknown }).__threadforge = { store: useStore };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
