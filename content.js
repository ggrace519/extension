// Prevent multiple initializations
let initialized = false;
let checkBodyInterval = null;

// Wait for DOM to be ready before initializing
function initExtension() {
  // Prevent multiple calls
  if (initialized) {
    return;
  }

  try {
    // Ensure body exists
    if (!document.body) {
      console.warn("Extension: document.body not available yet");
      return;
    }

    // Create a div to host the Svelte app (only if it doesn't exist)
    if (!document.getElementById("extension-app")) {
      const appDiv = document.createElement("div");
      appDiv.id = "extension-app";
      document.body.appendChild(appDiv);
    }

    // Function to inject a CSS file
    function injectCSS(file) {
      try {
        const existingLink = document.querySelector(`link[href="${file}"]`);
        if (!existingLink) {
          const link = document.createElement("link");
          link.href = file;
          link.type = "text/css";
          link.rel = "stylesheet";
          const head = document.head || document.getElementsByTagName("head")[0];
          if (head) {
            head.appendChild(link);
          } else {
            console.warn("Extension: Could not find head element");
          }
        }
      } catch (error) {
        console.error("Extension: Error injecting CSS:", error);
      }
    }

    // Inject the CSS file
    injectCSS(chrome.runtime.getURL("extension/dist/style.css"));
    
    initialized = true;
  } catch (error) {
    console.error("Extension: Error initializing:", error);
  }
}

// Run immediately if DOM is ready, otherwise wait
if (document.body) {
  initExtension();
} else {
  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initExtension();
    }, { once: true });
  } else {
    // DOM already loaded, but body might not exist yet
    checkBodyInterval = setInterval(() => {
      if (document.body) {
        clearInterval(checkBodyInterval);
        checkBodyInterval = null;
        initExtension();
      }
    }, 10);
    
    // Safety timeout
    setTimeout(() => {
      if (checkBodyInterval) {
        clearInterval(checkBodyInterval);
        checkBodyInterval = null;
      }
      if (document.body && !initialized) {
        initExtension();
      }
    }, 5000);
  }
}
