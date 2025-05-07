// content.js - Chrome Extension Content Script
// Strategy: Inject webscript.js directly into the main page,
// as draw.io seems to be running in the top window, not an iframe.

console.log("[MCP EXT] Content script loaded. Attempting to inject webscript.js into main page...");

/**
 * Injects the webscript.js file into the main page's context
 * by adding a <script> tag.
 */
function injectScript() {
    try {
        const script = document.createElement('script');
        // Important: Set type to module if webscript.js uses import/export
        // script.type = 'module'; // Uncomment if webscript.js uses ES Modules
        script.src = chrome.runtime.getURL('webscript.js');

        script.onload = function() {
            console.log("[MCP EXT] ✅ webscript.js script tag loaded.");
            // Clean up the script tag from the DOM after it has loaded.
            this.remove();
        };

        script.onerror = function(e) {
            console.error("[MCP EXT] ❌ Failed to load webscript.js script tag.", e);
        };

        // Append the script to the head or body. Head is generally preferred.
        (document.head || document.documentElement).appendChild(script);
        console.log("[MCP EXT] Injected <script> tag for webscript.js");

    } catch (e) {
        console.error("[MCP EXT] ❌ Error creating or appending script tag:", e);
    }
}

// --- Initialization ---

// Run the injection when the document is ready.
// 'document_idle' (from manifest) is usually sufficient, but we can also check state here.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log("[MCP EXT] Document already ready. Injecting script.");
    injectScript();
} else {
    // Fallback if script runs very early (less likely with document_idle)
     document.addEventListener('DOMContentLoaded', () => {
        console.log("[MCP EXT] DOMContentLoaded event fired. Injecting script.");
        injectScript();
     }, { once: true }); // Run only once
}