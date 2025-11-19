export const getModels = async (key, url) => {
  // Proxy through background script to avoid CORS
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "fetchModels",
        url: url,
        key: key,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response.error) {
          reject(response.error);
          return;
        }
        
        let models = response.data?.data ?? [];
        models = models
          .filter((models) => models)
          .sort((a, b) => {
            // Compare case-insensitively
            const lowerA = a.name.toLowerCase();
            const lowerB = b.name.toLowerCase();

            if (lowerA < lowerB) return -1;
            if (lowerA > lowerB) return 1;

            // If same case-insensitively, sort by original strings,
            // lowercase will come before uppercase due to ASCII values
            if (a < b) return -1;
            if (a > b) return 1;

            return 0; // They are equal
          });

        // Log model count instead of full array to reduce console noise
        if (models.length > 0) {
          console.log(`Extension: Loaded ${models.length} model(s)`);
        }
        resolve(models);
      }
    );
  });
};

export const generateOpenAIChatCompletion = async (
  api_key = "",
  body = {},
  url = "http://localhost:8080"
) => {
  // Create a port for streaming data from background script
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "chat-stream" });
    let controller = null;
    let streamEnded = false;
    
    // Create a ReadableStream that reads from the port
    const stream = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
      }
    });
    
    port.onMessage.addListener((msg) => {
      if (msg.error) {
        if (controller) {
          controller.error(new Error(msg.error));
        }
        port.disconnect();
        reject(new Error(msg.error));
        return;
      }
      
      if (msg.done) {
        streamEnded = true;
        if (controller) {
          controller.close();
        }
        port.disconnect();
        return;
      }
      
      if (msg.chunk && controller) {
        controller.enqueue(new TextEncoder().encode(msg.chunk));
      }
    });
    
    port.onDisconnect.addListener(() => {
      if (!streamEnded && controller) {
        controller.error(new Error("Stream disconnected unexpectedly"));
      }
    });
    
    // Create Response-like object immediately
    const response = {
      ok: true,
      status: 200,
      body: stream,
    };
    
    // Send the fetch request
    port.postMessage({
      action: "fetchChatCompletion",
      url: url,
      api_key: api_key,
      body: body,
    });
    
    // Resolve immediately with the stream
    resolve([response, { abort: () => { port.disconnect(); } }]);
  });
};
