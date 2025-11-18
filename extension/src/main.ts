// ============================================================================
// ENHANCEMENT: DOM Element Wait Before Mounting
// ============================================================================
// Waits for the extension-app element to exist before mounting the Svelte app.
// This prevents "Cannot read properties of undefined" errors when the content
// script runs before the DOM is fully ready. Includes retry logic.
// ============================================================================

import "./app.css";
import App from "./App.svelte";

function initApp() {
  const targetElement = document.getElementById("extension-app");
  if (targetElement) {
    const app = new App({
      target: targetElement,
    });
    return app;
  } else {
    console.warn("Extension app target element not found, retrying...");
    // Retry after a short delay
    setTimeout(initApp, 100);
    return null;
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  // DOM already loaded
  initApp();
}

export default initApp();
