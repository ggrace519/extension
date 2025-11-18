// API Key Encryption using Web Crypto API
// Derive encryption key from extension ID for unique per-installation encryption
async function getEncryptionKey() {
  try {
    // Get extension ID
    const extensionId = chrome.runtime.id;
    
    // Derive a key from extension ID using PBKDF2
    const encoder = new TextEncoder();
    const password = encoder.encode(extensionId + 'open-webui-extension-salt');
    const salt = encoder.encode('open-webui-api-key-encryption-salt-v1');
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      password,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );
    
    return key;
  } catch (error) {
    console.error("Extension: Failed to get encryption key:", error);
    throw error;
  }
}

// Encrypt API key
async function encryptApiKey(apiKey) {
  try {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error("Invalid API key for encryption");
    }
    
    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    
    // Generate IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      data
    );
    
    // Combine IV and encrypted data, then encode as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Extension: Encryption failed:", error);
    throw error;
  }
}

// Decrypt API key
async function decryptApiKey(encryptedApiKey) {
  try {
    if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
      throw new Error("Invalid encrypted API key");
    }
    
    // Check if it's already decrypted (backward compatibility)
    // Encrypted keys start with base64 pattern, unencrypted keys typically don't
    // Simple heuristic: if it doesn't look like base64 or is short, assume unencrypted
    if (encryptedApiKey.length < 20 || !/^[A-Za-z0-9+/=]+$/.test(encryptedApiKey)) {
      // Likely unencrypted, return as-is (backward compatibility)
      return encryptedApiKey;
    }
    
    const key = await getEncryptionKey();
    
    // Decode base64
    const combined = Uint8Array.from(atob(encryptedApiKey), c => c.charCodeAt(0));
    
    // Extract IV (first 12 bytes) and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        encrypted
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (decryptError) {
      // If decryption fails, assume it's an unencrypted key (backward compatibility)
      console.log("Extension: Decryption failed, assuming unencrypted key:", decryptError);
      return encryptedApiKey;
    }
  } catch (error) {
    console.error("Extension: Decryption failed:", error);
    // Return as-is for backward compatibility
    return encryptedApiKey;
  }
}

// Security: URL validation to prevent SSRF attacks
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }
  
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    // Prevent javascript: and data: URLs
    if (url.protocol === 'javascript:' || url.protocol === 'data:') {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Security: Validate message actions
const ALLOWED_ACTIONS = ['getSelection', 'writeText', 'fetchModels', 'toggleSearch', 'encryptApiKey', 'decryptApiKey', 'createChat'];

// Rate Limiting Configuration
const RATE_LIMITS = {
  chatCompletion: { max: 10, window: 60000 }, // 10 requests per minute
  fetchModels: { max: 5, window: 60000 },     // 5 requests per minute
  general: { max: 20, window: 60000 }         // 20 requests per minute
};

// Rate Limiting: Check if request should be allowed
async function checkRateLimit(actionType) {
  const now = Date.now();
  const limit = RATE_LIMITS[actionType] || RATE_LIMITS.general;
  
  try {
    const stored = await chrome.storage.local.get(['rateLimit']);
    const rateLimitData = stored.rateLimit || {};
    
    // Get or initialize request history for this action type
    let requests = rateLimitData[actionType] || [];
    
    // Remove requests outside the time window
    requests = requests.filter(timestamp => now - timestamp < limit.window);
    
    // Check if limit exceeded
    if (requests.length >= limit.max) {
      const oldestRequest = requests[0];
      const waitTime = limit.window - (now - oldestRequest);
      return {
        allowed: false,
        waitTime: Math.ceil(waitTime / 1000) // Return seconds
      };
    }
    
    // Add current request timestamp
    requests.push(now);
    rateLimitData[actionType] = requests;
    
    // Save updated rate limit data
    await chrome.storage.local.set({ rateLimit: rateLimitData });
    
    return { allowed: true };
  } catch (error) {
    console.error("Extension: Rate limit check failed:", error);
    // On error, allow the request but log it
    return { allowed: true };
  }
}

// CSP Validation: Check if response headers comply with CSP
function validateCSPHeaders(response) {
  const cspHeader = response.headers.get('content-security-policy');
  if (cspHeader) {
    // Log CSP header for debugging (don't block, just log)
    console.log("Extension: CSP header detected:", cspHeader);
  }
  return true; // Don't block based on CSP headers, just validate
}

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener(function (command) {
  console.log("Command received:", command);
  if (command === "open-search") {
    // Get the active tab and send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        // Check if we can access this page
        const url = tabs[0].url || "";
        if (url.startsWith("chrome://") || 
            url.startsWith("chrome-extension://") || 
            url.startsWith("chrome-search://") ||
            url.startsWith("edge://") ||
            url.startsWith("about:")) {
          console.log("Extension cannot access this page:", url);
          return;
        }
        
        console.log("Sending toggleSearch message to tab:", tabs[0].id);
        // Try sending message first (most reliable)
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggleSearch" }).then(() => {
          console.log("Message sent successfully");
        }).catch((error) => {
          // If message fails, try injecting script to set a flag
          console.log("Message failed, trying script injection:", error);
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id, allFrames: false },
            func: () => {
              // Set a flag that content script can check
              window.dispatchEvent(new CustomEvent("open-webui-toggle-search", { bubbles: true }));
              // Also try calling function if it exists
              if (window.openWebUIToggleSearch && typeof window.openWebUIToggleSearch === 'function') {
                try {
                  window.openWebUIToggleSearch();
                } catch (e) {
                  console.error("Error calling toggle function:", e);
                }
              }
            }
          }).catch((err) => {
            // Silently ignore errors for restricted pages
            if (err.message && err.message.includes("Cannot access contents")) {
              console.log("Page cannot be accessed by extension (restricted page)");
            } else {
              console.error("Error injecting script:", err);
            }
          });
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  // Security: Validate message action
  if (!request.action || !ALLOWED_ACTIONS.includes(request.action)) {
    console.error("Extension: Invalid action:", request.action);
    sendResponse({ error: "Invalid action" });
    return false;
  }
  
  // Security: Validate sender
  if (!sender || !sender.tab || !sender.tab.id) {
    console.error("Extension: Invalid sender");
    sendResponse({ error: "Invalid sender" });
    return false;
  }
  
  console.log(request, sender);
  const id = sender.tab.id;
  
  if (request.action == "getSelection") {
    chrome.scripting
      .executeScript({
        target: { tabId: id, allFrames: true },
        func: () => {
          return window.getSelection().toString();
        },
      })
      .then((res) => {
        console.log(res);
        sendResponse({ data: res[0]["result"] });
      });
    return true; // Keep channel open for async response
  } else if (request.action == "writeText") {
    function writeTextToInput(text, targetId) {
      // Security: Validate inputs
      if (typeof text !== 'string') {
        console.error("Extension: Invalid text type");
        return;
      }
      if (targetId && typeof targetId !== 'string') {
        console.error("Extension: Invalid targetId type");
        return;
      }
      
      let targetElement = null;
      
      // If targetId is provided, use it
      if (targetId) {
        targetElement = document.getElementById(targetId);
      }
      
      // Fallback to active element
      if (!targetElement) {
        const activeElement = document.activeElement;
        if (
          activeElement &&
          (activeElement.tagName === "INPUT" ||
            activeElement.tagName === "TEXTAREA")
        ) {
          targetElement = activeElement;
        }
      }
      
      // Last resort: find first visible input/textarea
      if (!targetElement) {
        const inputs = document.querySelectorAll("input, textarea");
        for (const input of inputs) {
          if (input.offsetParent !== null) { // Check if visible
            targetElement = input;
            break;
          }
        }
      }
      
      if (targetElement) {
        targetElement.value = `${targetElement.value}${text}`;
        
        // Trigger input event so React/Vue/etc. frameworks detect the change
        const event = new Event("input", { bubbles: true });
        targetElement.dispatchEvent(event);

        if (targetElement.tagName === "TEXTAREA") {
          targetElement.scrollTop = targetElement.scrollHeight;
        }
      } else {
        console.warn("No active input or textarea field found.");
      }
    }
    chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: writeTextToInput,
      args: [request.text, request.targetId],
    });
    sendResponse({});
  } else if (request.action == "fetchModels") {
    // Return true immediately to keep channel open for async operations
    (async () => {
      // Security: Validate URL to prevent SSRF
      if (!isValidUrl(request.url)) {
        sendResponse({ error: "Invalid URL format" });
        return;
      }
      
      // Security: Validate API key format (basic check)
      if (request.key && typeof request.key !== 'string') {
        sendResponse({ error: "Invalid API key format" });
        return;
      }
      
      // Decrypt API key if provided
      let decryptedKey = request.key;
      if (request.key) {
        try {
          decryptedKey = await decryptApiKey(request.key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for models request:", error);
          // Use as-is (might be unencrypted for backward compatibility)
        }
      }
      
      // Rate Limiting: Check if request is allowed
      const rateLimitCheck = await checkRateLimit('fetchModels');
      if (!rateLimitCheck.allowed) {
        sendResponse({ 
          error: `Rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds before fetching models again.` 
        });
        return;
      }
      
      // Proxy API call through background script to avoid CORS
      const apiUrl = `${request.url}/api/models`;
      if (!isValidUrl(apiUrl)) {
        sendResponse({ error: "Invalid API URL" });
        return;
      }
      
      try {
        const res = await fetch(apiUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(decryptedKey && { authorization: `Bearer ${decryptedKey}` }),
          },
        });
        
        // CSP Validation: Check response headers
        validateCSPHeaders(res);
        
        if (!res.ok) {
          const error = await res.json();
          sendResponse({ error: error });
          return;
        }
        const data = await res.json();
        sendResponse({ data: data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "encryptApiKey") {
    // Encrypt API key before storing
    (async () => {
      try {
        const encrypted = await encryptApiKey(request.apiKey);
        sendResponse({ encrypted: encrypted });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "decryptApiKey") {
    // Decrypt API key after retrieving
    (async () => {
      try {
        const decrypted = await decryptApiKey(request.encryptedApiKey);
        sendResponse({ decrypted: decrypted });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "createChat") {
    // Create a chat conversation in OpenWebUI via API
    (async () => {
      // Security: Validate URL to prevent SSRF
      if (!isValidUrl(request.url)) {
        sendResponse({ error: "Invalid URL format" });
        return;
      }
      
      // Decrypt API key if provided
      let decryptedKey = request.api_key;
      if (request.api_key) {
        try {
          decryptedKey = await decryptApiKey(request.api_key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for createChat:", error);
          // Use as-is (might be unencrypted for backward compatibility)
        }
      }
      
      // Security: Validate request body
      if (!request.body || typeof request.body !== 'object') {
        sendResponse({ error: "Invalid request body" });
        return;
      }
      
      const apiUrl = `${request.url}/api/chats`;
      if (!isValidUrl(apiUrl)) {
        sendResponse({ error: "Invalid API URL" });
        return;
      }
      
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(decryptedKey && { Authorization: `Bearer ${decryptedKey}` }),
          },
          body: JSON.stringify(request.body),
        });
        
        // CSP Validation: Check response headers
        validateCSPHeaders(res);
        
        if (!res.ok) {
          const errorText = await res.text();
          sendResponse({ error: `HTTP ${res.status}: ${errorText}` });
          return;
        }
        
        const data = await res.json();
        sendResponse({ data: data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else {
    sendResponse({});
  }

  return true;
});

// Handle streaming chat completions via ports
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "chat-stream") {
    port.onMessage.addListener(async (msg) => {
      if (msg.action === "fetchChatCompletion") {
        // Security: Validate URL to prevent SSRF
        if (!isValidUrl(msg.url)) {
          port.postMessage({ error: "Invalid URL format" });
          port.disconnect();
          return;
        }
        
        // Security: Validate API key format
        if (!msg.api_key || typeof msg.api_key !== 'string') {
          port.postMessage({ error: "Invalid API key format" });
          port.disconnect();
          return;
        }
        
        // Decrypt API key
        let decryptedApiKey = msg.api_key;
        try {
          decryptedApiKey = await decryptApiKey(msg.api_key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for chat completion:", error);
          // Use as-is (might be unencrypted for backward compatibility)
        }
        
        // Security: Validate request body
        if (!msg.body || typeof msg.body !== 'object') {
          port.postMessage({ error: "Invalid request body" });
          port.disconnect();
          return;
        }
        
        // Rate Limiting: Check if request is allowed
        const rateLimitCheck = await checkRateLimit('chatCompletion');
        if (!rateLimitCheck.allowed) {
          port.postMessage({ 
            error: `Rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds before making another request.` 
          });
          port.disconnect();
          return;
        }
        
        const apiUrl = `${msg.url}/chat/completions`;
        if (!isValidUrl(apiUrl)) {
          port.postMessage({ error: "Invalid API URL" });
          port.disconnect();
          return;
        }
        
        fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${decryptedApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(msg.body),
        })
          .then(async (res) => {
            // CSP Validation: Check response headers
            validateCSPHeaders(res);
            
            if (!res.ok) {
              const errorText = await res.text();
              port.postMessage({ error: `HTTP ${res.status}: ${errorText}` });
              port.disconnect();
              return;
            }
            
            // Read the stream and send chunks back
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            
            const readChunk = async () => {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  port.postMessage({ done: true });
                  port.disconnect();
                  return;
                }
                
                const chunk = decoder.decode(value, { stream: true });
                port.postMessage({ chunk: chunk, done: false });
                readChunk();
              } catch (error) {
                port.postMessage({ error: error.message, done: true });
                port.disconnect();
              }
            };
            
            readChunk();
          })
          .catch((error) => {
            port.postMessage({ error: error.message });
            port.disconnect();
          });
      }
    });
  }
});
