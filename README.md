# Open WebUI Chrome Extension

A Chrome extension that provides quick access to Open WebUI with a spotlight-style search interface. Select text on any webpage and get AI-powered responses directly in your input fields, or open searches in Open WebUI.

![Extension Demo](./demo.gif)

## Features

- **Spotlight Search**: Press `Cmd/Ctrl + Space + Shift` to open a quick search interface
- **Text Selection**: Automatically captures selected text when opening the search
- **Direct AI Responses**: Use `Cmd/Ctrl + Enter + Shift` to get AI responses written directly into active input/textarea fields
- **Open WebUI Integration**: Seamlessly connects to your Open WebUI instance
- **Model Selection**: Choose from available models in your Open WebUI setup
- **Streaming Responses**: Real-time streaming of AI responses

## Prerequisites

- **Node.js** (v16 or higher) and **npm**
- **Chrome/Chromium-based browser** (Manifest V3 compatible)
- **Open WebUI instance** with API access

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd extension
```

### 2. Install Dependencies

Navigate to the `extension` directory and install the required packages:

```bash
cd extension
npm install
```

### 3. Build the Extension

Build the Svelte application:

```bash
npm run build
```

This will create the production build in `extension/dist/` directory with:
- `main.js` - The compiled JavaScript bundle
- `style.css` - The compiled CSS styles

### 4. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the root `extension` directory (the one containing `manifest.json`)
5. The extension should now appear in your extensions list

## Configuration

### First-Time Setup

1. **Open the extension**: Press `Cmd/Ctrl + Space + Shift` on any webpage
2. **Enter your Open WebUI URL**: 
   - Example: `http://localhost:8080` or `https://your-open-webui-instance.com`
   - Do not include a trailing slash
3. **Enter your API Key**: Your Open WebUI API key
4. **Fetch Models**: Click the refresh icon next to the API key field to load available models
5. **Select a Model**: Choose your preferred model from the dropdown
6. **Save**: Click the checkmark to save your configuration

### Resetting Configuration

To reset your configuration:
- Press `Cmd/Ctrl + Space + Shift` to open the search
- Press `Shift + Escape` while the search is open
- This will clear all stored settings and show the configuration screen again

## Usage

### Opening the Search Interface

- **Keyboard Shortcut**: `Cmd/Ctrl + Space + Shift`
- The search interface will appear as an overlay on the current page
- If you have text selected, it will automatically populate the search field

### Searching in Open WebUI

1. Open the search interface (`Cmd/Ctrl + Space + Shift`)
2. Type your query (or use selected text)
3. Press `Enter` to open the search in a new Open WebUI tab

### Getting AI Responses Directly

1. Select text on any webpage
2. Press `Cmd/Ctrl + Enter + Shift`
3. The AI response will be streamed directly into the active input or textarea field
4. Make sure you have an input or textarea focused before using this feature

### Closing the Search

- Press `Escape` to close the search interface
- Click outside the search modal to close it

## Development

### Project Structure

```
extension/
├── manifest.json          # Chrome extension manifest
├── background.js          # Service worker for extension
├── content.js            # Content script injected into web pages
├── images/               # Extension icons
└── extension/            # Svelte application
    ├── src/
    │   ├── App.svelte    # Main application component
    │   ├── main.ts       # Application entry point
    │   └── lib/
    │       ├── components/  # Svelte components
    │       ├── apis/        # API integration
    │       └── utils/       # Utility functions
    ├── dist/             # Build output (generated)
    └── package.json      # Dependencies and scripts
```

### Development Workflow

1. **Make changes** to files in `extension/src/`
2. **Build the extension**:
   ```bash
   cd extension
   npm run build
   ```
3. **Reload the extension** in Chrome:
   - Go to `chrome://extensions/`
   - Click the refresh icon on the extension card
4. **Test your changes** on a webpage

### Available Scripts

In the `extension/` directory:

- `npm run dev` - Start Vite development server (for testing outside extension context)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run check` - Run Svelte type checking

### Development Tips

- After building, always reload the extension in Chrome to see changes
- Check the browser console for any errors
- The extension uses Chrome Storage API for configuration persistence
- Content scripts are injected into all pages (`<all_urls>`)

## Troubleshooting

### Extension Not Loading

- Ensure you've built the extension (`npm run build` in the `extension/` directory)
- Check that `extension/dist/main.js` and `extension/dist/style.css` exist
- Verify you're loading the correct directory (the one with `manifest.json`)

### API Connection Issues

- Verify your Open WebUI URL is correct and accessible
- Check that your API key is valid
- Ensure CORS is properly configured on your Open WebUI instance
- Check the browser console for specific error messages

### Keyboard Shortcuts Not Working

- Some websites may intercept keyboard shortcuts
- Try on a different page or website
- Ensure no other extensions are conflicting with the shortcuts

### Models Not Loading

- Verify your API key has the correct permissions
- Check that your Open WebUI instance is running and accessible
- Ensure the `/api/models` endpoint is available

## Browser Compatibility

- Chrome 88+ (Manifest V3 support required)
- Edge 88+ (Chromium-based)
- Other Chromium-based browsers with Manifest V3 support

## Permissions

The extension requires the following permissions:

- `storage` - To save your Open WebUI configuration
- `scripting` - To interact with web pages and inject content
- `host_permissions: <all_urls>` - To work on all websites
- Content scripts on all URLs - To provide the search interface

## License

[Add your license information here]

## Contributing

[Add contribution guidelines here]
