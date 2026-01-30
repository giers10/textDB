import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initDb } from "./lib/db";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

initDb()
  .then(() => {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    root.innerHTML =
      '<div style="padding:24px;font-family:sans-serif;">Failed to start TextDB. Check the console for details.</div>';
  });
