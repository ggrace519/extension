<script lang="ts">
  import { onMount } from "svelte";
  import { generateOpenAIChatCompletion, getModels } from "../apis";
  import { splitStream } from "../utils";

  // ========================================================================
  // ENHANCEMENT: Response Popup and Conversation Management
  // ========================================================================
  // Added variables for displaying AI responses in a dedicated popup modal,
  // managing conversation history, and handling follow-up questions.
  // This allows users to have multi-turn conversations without leaving
  // the current webpage.
  // ========================================================================
  let show = false;
  let showConfig = true;
  let showResponse = false; // ENHANCEMENT: Controls response popup visibility
  let responseText = ""; // ENHANCEMENT: Current streaming response text
  let responseQuery = ""; // ENHANCEMENT: Original query that triggered response
  let followUpInput = ""; // ENHANCEMENT: Input field for follow-up questions
  let conversationHistory: Array<{role: string, content: string}> = []; // ENHANCEMENT: Multi-turn conversation history
  let isStreaming = false; // ENHANCEMENT: Tracks if response is currently streaming
  let errorMessage = ""; // ENHANCEMENT: Error message for rate limits, etc.
  let showError = false; // ENHANCEMENT: Controls error message visibility

  let url = "";
  let key = "";
  let model = "";

  let searchValue = "";
  let models = [];
  let responseContainer: HTMLElement | null = null;

  const resetConfig = () => {
    console.log("resetConfig");

    try {
      chrome.storage.local.clear().then(() => {
        console.log("Value is cleared");
      });
    } catch (error) {
      console.log(error);
      // Security: Removed localStorage fallback - chrome.storage.local is more secure
    }

    url = "";
    key = "";
    model = "";
    models = [];
    showConfig = true;
  };

  const submitHandler = (e) => {
    e.preventDefault();

    // Security: Validate URL and sanitize search value
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        console.error("Extension: Invalid URL protocol");
        return;
      }
      
      // Security: Sanitize search value (encodeURIComponent already handles this)
      const sanitizedQuery = encodeURIComponent(searchValue);
      const sanitizedModel = encodeURIComponent(model);
      
      window.open(
        `${url}/?q=${sanitizedQuery}&models=${sanitizedModel}`,
        "_blank"
      );

      searchValue = "";
      show = false;
    } catch (error) {
      console.error("Extension: Invalid URL format");
    }
  };

  const initHandler = async (e) => {
    e.preventDefault();

    // ========================================================================
    // ENHANCEMENT: API Key Encryption on Save
    // ========================================================================
    // Encrypts API key before storing in chrome.storage.local. This prevents
    // API keys from being stored in plain text. Includes URL and input validation.
    // ========================================================================
    // Security: Validate URL format before saving
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        console.error("Extension: Invalid URL protocol");
        return;
      }
    } catch (error) {
      console.error("Extension: Invalid URL format");
      return;
    }
    
    // Security: Basic API key validation (non-empty string)
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      console.error("Extension: Invalid API key");
      return;
    }
    
    // Security: Basic model validation
    if (!model || typeof model !== 'string' || model.trim().length === 0) {
      console.error("Extension: Invalid model");
      return;
    }

    try {
      // Encrypt API key before storing
      const encryptionResponse = await chrome.runtime.sendMessage({
        action: "encryptApiKey",
        apiKey: key.trim()
      });
      
      if (encryptionResponse.error) {
        console.error("Extension: Failed to encrypt API key:", encryptionResponse.error);
        // Fallback: store unencrypted (shouldn't happen, but for safety)
        chrome.storage.local.set({ 
          url: url.trim(), 
          key: key.trim(), 
          model: model.trim() 
        });
      } else {
        // Store encrypted API key
        chrome.storage.local.set({ 
          url: url.trim(), 
          key: encryptionResponse.encrypted, 
          model: model.trim() 
        }).then(() => {
          console.log("Value is set (API key encrypted)");
        });
      }
    } catch (error) {
      console.log(error);
      // Security: Removed localStorage fallback - chrome.storage.local is more secure
    }

    showConfig = false;
  };

  // Function to toggle search interface
  const toggleSearch = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getSelection",
      });

      if (response?.data ?? false) {
        searchValue = response.data;
      }
    } catch (error) {
      console.log("catch", error);
    }

    show = !show;

    setTimeout(() => {
      const inputElement = document.getElementById(
        "open-webui-search-input"
      );

      if (inputElement) {
        inputElement.focus();
      }
    }, 0);
  };

  // ========================================================================
  // ENHANCEMENT: Continue in OpenWebUI Feature
  // ========================================================================
  // Transfers the current conversation from the extension to the full OpenWebUI
  // interface. Creates a new chat via API and opens it in a new tab. Includes
  // fallback logic if API call fails.
  // ========================================================================
  // Function to continue conversation in OpenWebUI
  const continueInOpenWebUI = async () => {
    if (!url || conversationHistory.length === 0) {
      console.warn("Extension: No conversation to continue or URL not configured");
      return;
    }

    try {
      // Get current config (decrypt API key if needed)
      let currentUrl = url;
      let currentKey = key;
      
      try {
        const storedConfig = await chrome.storage.local.get(["url", "key"]);
        if (storedConfig.url) currentUrl = storedConfig.url;
        if (storedConfig.key) {
          // Decrypt API key if needed
          try {
            const decryptionResponse = await chrome.runtime.sendMessage({
              action: "decryptApiKey",
              encryptedApiKey: storedConfig.key
            });
            if (!decryptionResponse.error) {
              currentKey = decryptionResponse.decrypted;
            } else {
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            }
          } catch (error) {
            currentKey = storedConfig.key; // Use as-is (backward compatibility)
          }
        }
      } catch (error) {
        console.error("Extension: Error getting config:", error);
      }

      // Filter out system messages and format conversation for OpenWebUI
      const messages = conversationHistory.filter(m => m.role !== "system");
      
      if (messages.length === 0) {
        console.warn("Extension: No messages to send");
        return;
      }

      // Try to create a conversation via OpenWebUI API (proxied through background script)
      try {
        const createChatResponse = await chrome.runtime.sendMessage({
          action: "createChat",
          url: currentUrl,
          api_key: currentKey,
          body: {
            title: messages[0]?.content?.substring(0, 50) || "Extension Conversation",
            messages: messages,
          },
        });

        if (createChatResponse.data && createChatResponse.data.id) {
          // Open the conversation in OpenWebUI
          window.open(`${currentUrl}/chat/${createChatResponse.data.id}`, "_blank");
          return;
        } else if (createChatResponse.error) {
          console.log("Extension: Could not create chat via API, trying URL parameters:", createChatResponse.error);
        }
      } catch (apiError) {
        console.log("Extension: Could not create chat via API, trying URL parameters:", apiError);
      }

      // Fallback: Open with first message as query parameter
      // OpenWebUI will create a new conversation with this message
      const firstUserMessage = messages.find(m => m.role === "user");
      if (firstUserMessage) {
        const query = encodeURIComponent(firstUserMessage.content);
        window.open(`${currentUrl}/?q=${query}`, "_blank");
      } else {
        // Last resort: just open OpenWebUI
        window.open(currentUrl, "_blank");
      }
    } catch (error) {
      console.error("Extension: Error continuing in OpenWebUI:", error);
      // Fallback: just open the base URL
      try {
        const storedConfig = await chrome.storage.local.get(["url"]);
        if (storedConfig.url) {
          window.open(storedConfig.url, "_blank");
        }
      } catch (fallbackError) {
        console.error("Extension: Could not open OpenWebUI:", fallbackError);
      }
    }
  };

  // ========================================================================
  // ENHANCEMENT: Follow-up Questions Feature
  // ========================================================================
  // Allows users to ask follow-up questions in the response popup, maintaining
  // conversation context. Updates conversation history and streams new responses.
  // Includes client-side rate limiting checks and proper Svelte reactivity handling.
  // ========================================================================
  // Function to send follow-up question
  const sendFollowUp = async () => {
    // Client-side check to prevent UI spam (rate limiting is also handled by background script)
    if (!followUpInput.trim() || isStreaming) return;

    const question = followUpInput.trim();
    followUpInput = "";

    // Make sure previous assistant response is in history before adding new question
    if (responseText) {
      const alreadyInHistory = conversationHistory.some(
        m => m.role === "assistant" && m.content === responseText
      );
      
      if (!alreadyInHistory) {
        conversationHistory = [...conversationHistory, {
          role: "assistant",
          content: responseText,
        }];
      }
    }

    // Add user question to conversation history (reassign for reactivity)
    conversationHistory = [...conversationHistory, {
      role: "user",
      content: question,
    }];

    // Clear current streaming response and start new one
    responseText = "";
    isStreaming = true;
    
    // Focus the input after a short delay
    setTimeout(() => {
      const inputElement = document.getElementById("open-webui-followup-input");
      if (inputElement) {
        inputElement.focus();
      }
    }, 100);

    // Get current config
    let currentUrl = url;
    let currentKey = key;
    let currentModel = model;

        try {
          const storedConfig = await chrome.storage.local.get(["url", "key", "model"]);
          if (storedConfig.url) currentUrl = storedConfig.url;
          if (storedConfig.model) currentModel = storedConfig.model;
          
          // Decrypt API key if it exists
          if (storedConfig.key) {
            try {
              const decryptionResponse = await chrome.runtime.sendMessage({
                action: "decryptApiKey",
                encryptedApiKey: storedConfig.key
              });
              
              if (decryptionResponse.error) {
                console.error("Extension: Failed to decrypt API key:", decryptionResponse.error);
                currentKey = storedConfig.key; // Use as-is (backward compatibility)
              } else {
                currentKey = decryptionResponse.decrypted;
              }
            } catch (error) {
              console.error("Extension: Error decrypting API key:", error);
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            }
          }
        } catch (error) {
          // Extension context might be invalidated - use existing values
          if (error.message && error.message.includes("Extension context invalidated")) {
            // Silently use existing config values
          } else {
            console.log("Failed to get stored config:", error);
          }
        }

    // Determine endpoint
    const isOpenAI = models.length > 0 
      ? models.find((m) => m.id === currentModel)?.owned_by === "openai" ?? false
      : false;
    
    const endpoint = isOpenAI ? `${currentUrl}/openai` : `${currentUrl}/ollama/v1`;

    try {
      const [res, controller] = await generateOpenAIChatCompletion(
        currentKey,
        {
          model: currentModel,
          messages: conversationHistory,
          stream: true,
        },
        endpoint
      );

      if (res && res.ok) {
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(splitStream("\n"))
          .getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          try {
            let lines = value.split("\n");
            for (const line of lines) {
              if (line !== "") {
                if (line === "data: [DONE]") {
                  // Will handle after loop
                } else {
                  let data = JSON.parse(line.replace(/^data: /, ""));
                  if (!("request_id" in data)) {
                    const content = data.choices[0].delta.content ?? "";
                    responseText += content;
                    
                    if (responseContainer) {
                      setTimeout(() => {
                        responseContainer.scrollTop = responseContainer.scrollHeight;
                      }, 0);
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log(error);
          }
        }
        
        // Add assistant response to conversation history after streaming completes
        try {
          if (responseText) {
            // Check if this response is already in history (avoid duplicates)
            const alreadyInHistory = conversationHistory.some(
              m => m.role === "assistant" && m.content === responseText
            );
            
            if (!alreadyInHistory) {
              // Reassign to trigger Svelte reactivity
              conversationHistory = [...conversationHistory, {
                role: "assistant",
                content: responseText,
              }];
            }
          }
          isStreaming = false;
          // Clear responseText after adding to history so it doesn't interfere with display
          responseText = "";
          
          // Focus the follow-up input after response completes
          setTimeout(() => {
            const inputElement = document.getElementById("open-webui-followup-input");
            if (inputElement) {
              inputElement.focus();
            }
          }, 100);
        } catch (historyError) {
          // Even if adding to history fails, we should still show the response
          console.error("Extension: Error adding response to history:", historyError);
          isStreaming = false;
          // Don't clear responseText if we couldn't add it to history
        }
      } else {
        console.error("Extension: API request failed:", res);
        isStreaming = false;
      }
    } catch (error) {
      console.error("Extension: Error sending follow-up:", error);
      
      // Check if it's a rate limit error
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes("Rate limit exceeded")) {
        errorMessage = errorMsg;
        showError = true;
        // Auto-hide error after 5 seconds
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      }
      
      // If we have a response but hit an error, try to save it anyway
      if (responseText && isStreaming) {
        try {
          const alreadyInHistory = conversationHistory.some(
            m => m.role === "assistant" && m.content === responseText
          );
          if (!alreadyInHistory) {
            conversationHistory = [...conversationHistory, {
              role: "assistant",
              content: responseText,
            }];
          }
        } catch (saveError) {
          console.error("Extension: Could not save response:", saveError);
        }
      }
      isStreaming = false;
    }
  };

  onMount(async () => {
    // Store toggle function globally so injected scripts can call it
    (window as any).openWebUIToggleSearch = toggleSearch;
    
    // Listen for custom event from background script (keyboard shortcut)
    const handleToggleEvent = () => {
      toggleSearch();
    };
    window.addEventListener("open-webui-toggle-search", handleToggleEvent);
    
    // Also listen for messages as fallback
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log("Content script received message:", request);
      if (request.action === "toggleSearch") {
        console.log("Toggling search interface");
        toggleSearch();
        sendResponse({ success: true });
      }
      return true;
    });

    const down = async (e) => {
      // Reset the configuration when ⌘Shift+Escape is pressed
      if (show && e.shiftKey && e.key === "Escape") {
        resetConfig();
      } else if (e.key === "Escape") {
        if (showResponse) {
          showResponse = false;
          responseText = "";
          responseQuery = "";
          followUpInput = "";
          conversationHistory = [];
          isStreaming = false;
        } else {
          show = false;
        }
      }

      // ====================================================================
      // ENHANCEMENT: Direct AI Response via Keyboard Shortcut
      // ====================================================================
      // Ctrl+Shift+Enter (or Cmd+Shift+Enter) with selected text triggers
      // an AI response popup instead of navigating to OpenWebUI. Includes
      // API key decryption, conversation history management, and streaming
      // response display. Always fetches fresh config from storage.
      // ====================================================================
      // Handle Ctrl+Shift+Enter (or Cmd+Shift+Enter) - get AI response directly
      if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        (e.shiftKey || e.altKey)
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Always fetch fresh config from storage to ensure we have it
        let currentUrl = url;
        let currentKey = key;
        let currentModel = model;

        try {
          const storedConfig = await chrome.storage.local.get(["url", "key", "model"]);
          if (storedConfig.url) {
            currentUrl = storedConfig.url;
            url = storedConfig.url;
          }
          if (storedConfig.model) {
            currentModel = storedConfig.model;
            model = storedConfig.model;
          }
          
          // Decrypt API key if it exists
          if (storedConfig.key) {
            try {
              const decryptionResponse = await chrome.runtime.sendMessage({
                action: "decryptApiKey",
                encryptedApiKey: storedConfig.key
              });
              
              if (decryptionResponse.error) {
                console.error("Extension: Failed to decrypt API key:", decryptionResponse.error);
                currentKey = storedConfig.key; // Use as-is (backward compatibility)
                key = storedConfig.key;
              } else {
                currentKey = decryptionResponse.decrypted;
                key = decryptionResponse.decrypted;
              }
            } catch (error) {
              console.error("Extension: Error decrypting API key:", error);
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
              key = storedConfig.key;
            }
          }
        } catch (error) {
          // Extension context might be invalidated - use existing values
          if (error.message && error.message.includes("Extension context invalidated")) {
            // Silently use existing config values
          } else {
            console.log("Failed to get stored config:", error);
          }
        }

        // Check if we have valid config
        if (!currentUrl || !currentKey || !currentModel) {
          console.warn("Extension: Missing configuration. Please configure the extension first.");
          return;
        }

        try {
          const response = await chrome.runtime.sendMessage({
            action: "getSelection",
          });

          if (response?.data ?? false) {
            // Initialize conversation
            responseQuery = response.data;
            responseText = "";
            // Reassign to ensure reactivity
            conversationHistory = [
              {
                role: "system",
                content: "You are a helpful assistant.",
              },
              {
                role: "user",
                content: response.data,
              },
            ];
            showResponse = true;
            isStreaming = true;

            // Store the active element before making API call (optional - for writing to input)
            const activeElement = document.activeElement;
            let targetElement = null;
            
            if (activeElement && 
                (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
              targetElement = activeElement;
            }
            
            let targetId = null;
            if (targetElement) {
              targetId = targetElement.id || `open-webui-target-${Date.now()}`;
              if (!targetElement.id) {
                targetElement.id = targetId;
              }
            }

            // Determine endpoint - check if model is OpenAI compatible
            // If models array is empty (API failed), default to ollama endpoint
            const isOpenAI = models.length > 0 
              ? models.find((m) => m.id === currentModel)?.owned_by === "openai" ?? false
              : false;
            
            const endpoint = isOpenAI ? `${currentUrl}/openai` : `${currentUrl}/ollama/v1`;

            const [res, controller] = await generateOpenAIChatCompletion(
              currentKey,
              {
                model: currentModel,
                messages: conversationHistory,
                stream: true,
              },
              endpoint
            );

            if (res && res.ok) {
              const reader = res.body
                .pipeThrough(new TextDecoderStream())
                .pipeThrough(splitStream("\n"))
                .getReader();

              let responseComplete = false;
              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  break;
                }

                try {
                  let lines = value.split("\n");
                  for (const line of lines) {
                    if (line !== "") {
                      console.log(line);
                      if (line === "data: [DONE]") {
                        console.log("DONE");
                        responseComplete = true;
                      } else {
                        let data = JSON.parse(line.replace(/^data: /, ""));
                        console.log(data);

                        if ("request_id" in data) {
                          console.log(data.request_id);
                        } else {
                          const content = data.choices[0].delta.content ?? "";
                          // Update popup display
                          responseText += content;
                          
                          // Auto-scroll to bottom as content streams in
                          if (responseContainer) {
                            setTimeout(() => {
                              responseContainer.scrollTop = responseContainer.scrollHeight;
                            }, 0);
                          }
                          
                          // Optionally also write to input field if one was focused
                          if (targetId && content) {
                            await chrome.runtime.sendMessage({
                              action: "writeText",
                              text: content,
                              targetId: targetId,
                            });
                          }
                        }
                      }
                    }
                  }
                } catch (error) {
                  console.log(error);
                }
              }
              
              // Add assistant response to conversation history after streaming completes
              try {
                if (responseText) {
                  // Check if this response is already in history (avoid duplicates)
                  const alreadyInHistory = conversationHistory.some(
                    m => m.role === "assistant" && m.content === responseText
                  );
                  
                  if (!alreadyInHistory) {
                    // Reassign to trigger Svelte reactivity
                    conversationHistory = [...conversationHistory, {
                      role: "assistant",
                      content: responseText,
                    }];
                  }
                }
                isStreaming = false;
                // Clear responseText after adding to history so it doesn't interfere with display
                responseText = "";
                
                // Focus the follow-up input after response completes
                setTimeout(() => {
                  const inputElement = document.getElementById("open-webui-followup-input");
                  if (inputElement) {
                    inputElement.focus();
                  }
                }, 100);
              } catch (historyError) {
                // Even if adding to history fails, we should still show the response
                console.error("Extension: Error adding response to history:", historyError);
                isStreaming = false;
                // Don't clear responseText if we couldn't add it to history
                // This way it will still be displayed
              }
            } else {
              console.error("Extension: API request failed:", res);
              showResponse = false;
              isStreaming = false;
            }
          } else {
            // Silently ignore if no text is selected - user might have accidentally triggered the shortcut
          }
        } catch (error) {
          console.error("Extension: Error getting AI response:", error);
          
          // Check if it's a rate limit error
          const errorMsg = error?.message || String(error);
          if (errorMsg.includes("Rate limit exceeded")) {
            errorMessage = errorMsg;
            showError = true;
            showResponse = true; // Keep popup open to show error
            // Auto-hide error after 5 seconds
            setTimeout(() => {
              showError = false;
              errorMessage = "";
            }, 5000);
          }
          
          // If we have a response but hit an error, try to save it anyway
          if (responseText && isStreaming) {
            try {
              const alreadyInHistory = conversationHistory.some(
                m => m.role === "assistant" && m.content === responseText
              );
              if (!alreadyInHistory) {
                conversationHistory = [...conversationHistory, {
                  role: "assistant",
                  content: responseText,
                }];
              }
            } catch (saveError) {
              console.error("Extension: Could not save response:", saveError);
            }
          }
          isStreaming = false;
        }
      }
    };

    // Attach event listener immediately, before async operations
    document.addEventListener("keydown", down, { capture: true, passive: false });
    
    // Now load configuration asynchronously
    let _storageCache = null;

    try {
      _storageCache = await chrome.storage.local.get();
    } catch (error) {
      console.log(error);
    }

    if (_storageCache) {
      url = _storageCache.url ?? "";
      model = _storageCache.model ?? "";
      
      // Decrypt API key if it exists
      if (_storageCache.key) {
        try {
          const decryptionResponse = await chrome.runtime.sendMessage({
            action: "decryptApiKey",
            encryptedApiKey: _storageCache.key
          });
          
          if (decryptionResponse.error) {
            console.error("Extension: Failed to decrypt API key:", decryptionResponse.error);
            // Use as-is (might be unencrypted for backward compatibility)
            key = _storageCache.key;
          } else {
            key = decryptionResponse.decrypted;
          }
        } catch (error) {
          console.error("Extension: Error decrypting API key:", error);
          // Use as-is (might be unencrypted for backward compatibility)
          key = _storageCache.key;
        }
      } else {
        key = "";
      }
      
      // ====================================================================
      // ENHANCEMENT: Improved Configuration Loading
      // ====================================================================
      // Config screen is hidden if all required values exist, even if models
      // API fails (e.g., due to CORS on other sites). This allows the extension
      // to work on any website, not just the OpenWebUI instance. Models are
      // loaded in the background as a non-blocking operation.
      // ====================================================================
      // If we have all required config, hide config screen
      // (even if models API fails, we can still use the extension)
      if (_storageCache.url && key && _storageCache.model) {
        showConfig = false;
        
        // Try to load models in the background (non-blocking)
        try {
          models = await getModels(key, _storageCache.url);
          // Models loaded successfully, but config screen stays hidden
        } catch (error) {
          // CORS errors are expected when loading models from other sites - this is non-critical
          // Rate limit errors are also non-critical for background loading
          const errorMsg = error?.message || String(error);
          if (!errorMsg.includes("CORS") && 
              !errorMsg.includes("Failed to fetch") && 
              !errorMsg.includes("Rate limit exceeded")) {
            console.log("Failed to load models (non-critical):", error);
          }
          // Models failed to load, but we still have config - keep config screen hidden
          // User can still use the extension with the stored model
        }
      } else {
        // Missing required config - show config screen
        showConfig = true;
      }
    } else {
      // No config found - show config screen
      showConfig = true;
    }
    
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("open-webui-toggle-search", handleToggleEvent);
      delete (window as any).openWebUIToggleSearch;
    };
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if show}
  <div
    class="tlwd-fixed tlwd-top-0 tlwd-right-0 tlwd-left-0 tlwd-bottom-0 tlwd-w-full tlwd-min-h-screen tlwd-h-screen tlwd-flex tlwd-justify-center tlwd-z-[9999999999] tlwd-overflow-hidden tlwd-overscroll-contain"
    on:mousedown={() => {
      show = false;
    }}
  >
    {#if showConfig}
      <div class=" tlwd-m-auto tlwd-max-w-sm tlwd-w-full tlwd-pb-32">
        <div
          class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-2.5 tlwd-px-3.5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation"
        >
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <form
            class="tlwd-text-gray-200 tlwd-w-full tlwd-p-0 tlwd-m-0"
            on:submit={initHandler}
            on:mousedown={(e) => {
              e.stopPropagation();
            }}
            autocomplete="off"
          >
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full">
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
              </div>
              <input
                id="open-webui-url-input"
                placeholder="Open WebUI URL"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={url}
                autocomplete="one-time-code"
                required
              />
            </div>
            <div
              class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mt-2"
            >
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                  />
                </svg>
              </div>
              <input
                placeholder="Open WebUI API Key"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={key}
                autocomplete="one-time-code"
                required
              />
              <button
                class=" tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                type="button"
                on:click={async () => {
                  if (url.endsWith("/")) {
                    url = url.slice(0, -1);
                  }

                  try {
                    models = await getModels(key, url);
                    // Clear any previous errors
                    showError = false;
                    errorMessage = "";
                  } catch (error) {
                    const errorMsg = error?.message || String(error);
                    if (errorMsg.includes("Rate limit exceeded")) {
                      errorMessage = errorMsg;
                      showError = true;
                      setTimeout(() => {
                        showError = false;
                        errorMessage = "";
                      }, 5000);
                    } else {
                      console.error("Extension: Error fetching models:", error);
                    }
                  }
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </button>
            </div>

            {#if models && models.length > 0}
              <div
                class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mt-2"
              >
                <div class=" tlwd-flex tlwd-items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2.5}
                    stroke="currentColor"
                    class="tlwd-size-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
                    />
                  </svg>
                </div>
                <select
                  id="open-webui-model-input"
                  class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                  bind:value={model}
                  autocomplete="off"
                  required
                >
                  <option value="">Select a model</option>
                  {#each models as model}
                    <option value={model.id}>{model.name ?? model.id}</option>
                  {/each}
                </select>
                <button
                  class=" tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                  type="submit"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2.5}
                    stroke="currentColor"
                    class="tlwd-size-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                </button>
              </div>
            {/if}
          </form>
        </div>
      </div>
    {:else}
      <div class=" tlwd-m-auto tlwd-max-w-xl tlwd-w-full tlwd-pb-32">
        <div
          class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-2.5 tlwd-px-3.5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation"
        >
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <form
            class="tlwd-text-gray-200 tlwd-w-full tlwd-p-0 tlwd-m-0"
            on:submit={submitHandler}
            on:mousedown={(e) => {
              e.stopPropagation();
            }}
            autocomplete="off"
          >
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full">
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
              </div>
              <input
                id="open-webui-search-input"
                placeholder="Search Open WebUI"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={searchValue}
                autocomplete="one-time-code"
              />
            </div>

            <div
              class=" tlwd-flex tlwd-justify-end tlwd-gap-1 tlwd-items-center"
            >
              <div
                class="tlwd-text-right tlwd-text-[0.7rem] tlwd-p-0 tlwd-m-0 tlwd-text-neutral-300 tlwd-h-fit"
              >
                Press ⌘Space+Shift to toggle
              </div>
              <button
                class=" tlwd-h-fit tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                type="button"
                on:click={() => {
                  showConfig = true;
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ========================================================================
     ENHANCEMENT: Response Popup Modal
     ========================================================================
     Displays AI responses in a dedicated modal popup with:
     - Streaming response display with auto-scroll
     - Conversation history (user and assistant messages)
     - Follow-up question input
     - Copy conversation button
     - Continue in OpenWebUI button
     - Error message display for rate limits
     ======================================================================== -->
<!-- Response Popup -->
{#if showResponse}
  <div
    class="tlwd-fixed tlwd-top-0 tlwd-right-0 tlwd-left-0 tlwd-bottom-0 tlwd-w-full tlwd-min-h-screen tlwd-h-screen tlwd-flex tlwd-justify-center tlwd-z-[9999999999] tlwd-overflow-hidden tlwd-overscroll-contain"
            on:mousedown={() => {
              showResponse = false;
              responseText = "";
              responseQuery = "";
              followUpInput = "";
              conversationHistory = [];
              isStreaming = false;
            }}
  >
    <div class="tlwd-m-auto tlwd-max-w-3xl tlwd-w-full tlwd-pb-32 tlwd-px-4">
      <div
        class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-4 tlwd-px-5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation tlwd-max-h-[80vh] tlwd-overflow-hidden tlwd-flex tlwd-flex-col"
        on:mousedown={(e) => {
          e.stopPropagation();
        }}
      >
        <!-- Header -->
        <div class="tlwd-flex tlwd-items-center tlwd-justify-between tlwd-mb-4 tlwd-pb-3 tlwd-border-b tlwd-border-gray-700">
          <div class="tlwd-flex tlwd-items-center tlwd-gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width={2.5}
              stroke="currentColor"
              class="tlwd-size-5 tlwd-text-neutral-300"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
              />
            </svg>
            <h3 class="tlwd-text-lg tlwd-font-semibold tlwd-text-neutral-100">AI Response</h3>
          </div>
          <button
            class="tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-400 hover:tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-1 tlwd-outline-none tlwd-border-none tlwd-transition-colors"
            on:click={() => {
              showResponse = false;
              responseText = "";
              responseQuery = "";
              followUpInput = "";
              conversationHistory = [];
              isStreaming = false;
            }}
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width={2.5}
              stroke="currentColor"
              class="tlwd-size-5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- Conversation History -->
        <div 
          class="tlwd-flex-1 tlwd-overflow-y-auto tlwd-pr-2 tlwd-mb-4"
          bind:this={responseContainer}
        >
          {#each conversationHistory as message, index}
            {#if message.role === "user"}
              <div class="tlwd-mb-4">
                <div class="tlwd-text-xs tlwd-text-neutral-400 tlwd-mb-1">You:</div>
                <div class="tlwd-text-sm tlwd-text-neutral-200 tlwd-bg-gray-800/50 tlwd-rounded-lg tlwd-p-3">
                  {message.content}
                </div>
              </div>
            {:else if message.role === "assistant"}
              <div class="tlwd-mb-4">
                <div class="tlwd-text-xs tlwd-text-neutral-400 tlwd-mb-1">Assistant:</div>
                <div class="tlwd-text-sm tlwd-text-neutral-100 tlwd-whitespace-pre-wrap tlwd-leading-relaxed">
                  {message.content}
                </div>
              </div>
            {/if}
          {/each}
          
          <!-- Current streaming response (only show if streaming) -->
          {#if responseText && isStreaming}
            <div class="tlwd-mb-4">
              <div class="tlwd-text-xs tlwd-text-neutral-400 tlwd-mb-1">Assistant:</div>
              <div class="tlwd-text-sm tlwd-text-neutral-100 tlwd-whitespace-pre-wrap tlwd-leading-relaxed">
                {responseText}
                <span class="tlwd-inline-block tlwd-w-2 tlwd-h-4 tlwd-bg-neutral-400 tlwd-ml-1 tlwd-animate-pulse">|</span>
              </div>
            </div>
          {:else if isStreaming && !responseText}
            <div class="tlwd-mb-4">
              <div class="tlwd-text-xs tlwd-text-neutral-400 tlwd-mb-1">Assistant:</div>
              <span class="tlwd-text-neutral-400 tlwd-italic">Waiting for response...</span>
            </div>
          {/if}
        </div>

        <!-- Error Message -->
        {#if showError && errorMessage}
          <div class="tlwd-mb-3 tlwd-p-3 tlwd-bg-red-900/20 tlwd-border tlwd-border-red-700/50 tlwd-rounded-lg">
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width={2.5}
                stroke="currentColor"
                class="tlwd-size-5 tlwd-text-red-400"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <p class="tlwd-text-sm tlwd-text-red-300">{errorMessage}</p>
            </div>
          </div>
        {/if}

        <!-- Follow-up Input -->
        <div class="tlwd-border-t tlwd-border-gray-700 tlwd-pt-3">
          <form
            on:submit|preventDefault={sendFollowUp}
            class="tlwd-flex tlwd-items-center tlwd-gap-2"
          >
            <input
              id="open-webui-followup-input"
              type="text"
              placeholder="Ask a follow-up question..."
              bind:value={followUpInput}
              disabled={isStreaming}
              class="tlwd-flex-1 tlwd-px-3 tlwd-py-2 tlwd-text-sm tlwd-bg-gray-800/50 tlwd-border tlwd-border-gray-700 tlwd-rounded-lg tlwd-text-neutral-100 placeholder:tlwd-text-neutral-500 tlwd-outline-none focus:tlwd-border-gray-600 disabled:tlwd-opacity-50 disabled:tlwd-cursor-not-allowed"
              autocomplete="off"
            />
            <button
              type="submit"
              disabled={!followUpInput.trim() || isStreaming}
              class="tlwd-px-4 tlwd-py-2 tlwd-text-sm tlwd-font-medium tlwd-bg-blue-600 hover:tlwd-bg-blue-700 disabled:tlwd-opacity-50 disabled:tlwd-cursor-not-allowed tlwd-text-white tlwd-rounded-lg tlwd-transition-colors tlwd-outline-none tlwd-border-none"
            >
              Send
            </button>
          </form>
          
          <!-- Footer -->
          <div class="tlwd-mt-3 tlwd-flex tlwd-items-center tlwd-justify-between">
            <div class="tlwd-text-xs tlwd-text-neutral-400">
              Press Escape to close
            </div>
            <div class="tlwd-flex tlwd-items-center tlwd-gap-3">
              <button
                class="tlwd-text-xs tlwd-text-blue-400 hover:tlwd-text-blue-300 tlwd-cursor-pointer tlwd-outline-none tlwd-border-none tlwd-bg-transparent tlwd-transition-colors tlwd-flex tlwd-items-center tlwd-gap-1"
                on:click={continueInOpenWebUI}
                type="button"
                disabled={conversationHistory.length === 0}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2}
                  stroke="currentColor"
                  class="tlwd-size-4"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
                Continue in OpenWebUI
              </button>
              <button
                class="tlwd-text-xs tlwd-text-neutral-300 hover:tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-outline-none tlwd-border-none tlwd-bg-transparent tlwd-transition-colors"
                on:click={() => {
                  // Copy full conversation to clipboard
                  const fullConversation = conversationHistory
                    .filter(m => m.role !== "system")
                    .map(m => `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`)
                    .join("\n\n");
                  navigator.clipboard.writeText(fullConversation);
                }}
                type="button"
              >
                Copy conversation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
