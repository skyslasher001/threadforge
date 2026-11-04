import { StrictMode } from "react";
import { useShow } from "./state/showcase";
import { useBrand } from "./state/brand";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { newDesign, useStore } from "./state/store";
import { useMacros } from "./lib/macros";

// Debug/test hook: lets automated tests and the dev console inspect app state.
(window as unknown as { __threadforge: unknown }).__threadforge = { store: useStore, show: useShow, brand: useBrand, macros: useMacros, newDesign };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
