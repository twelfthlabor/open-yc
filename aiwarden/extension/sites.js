/* Site adapters: where the composer and send button live on each AI chat site.
 *
 * Selectors are tried in order, then the generic fallback. Sites change their markup often, so every
 * adapter ends in generic selectors and the content script fails open when nothing matches.
 */
(function (root) {
  "use strict";

  const GENERIC = {
    composer: ["textarea", "[contenteditable='true']", "[contenteditable='']", "[contenteditable='plaintext-only']", "[role='textbox']"],
    send: ["button[type='submit']", "button[aria-label*='send' i]", "button[data-testid*='send' i]", "button[aria-label*='submit' i]"],
  };

  const SITES = [
    { id: "chatgpt", name: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"],
      composer: ["#prompt-textarea", "form [contenteditable='true']"],
      send: ["button[data-testid='send-button']", "#composer-submit-button"] },
    { id: "claude", name: "Claude", hosts: ["claude.ai"],
      composer: ["div.ProseMirror[contenteditable='true']", "[data-testid='chat-input']"],
      send: ["button[aria-label='Send message']", "button[aria-label='Send Message']"] },
    { id: "gemini", name: "Gemini", hosts: ["gemini.google.com", "aistudio.google.com"],
      composer: ["rich-textarea .ql-editor[contenteditable='true']", ".ql-editor[contenteditable='true']", "ms-autosize-textarea textarea"],
      send: ["button.send-button", "button[aria-label='Send message']", "run-button button"] },
    { id: "copilot", name: "Microsoft Copilot", hosts: ["copilot.microsoft.com"],
      composer: ["textarea#userInput", "textarea[data-testid='composer-input']"],
      send: ["button[data-testid='submit-button']", "button[aria-label='Submit message']"] },
    { id: "perplexity", name: "Perplexity", hosts: ["www.perplexity.ai", "perplexity.ai"],
      composer: ["#ask-input", "textarea[placeholder]"],
      send: ["button[data-testid='submit-button']", "button[aria-label='Submit']"] },
    { id: "deepseek", name: "DeepSeek", hosts: ["chat.deepseek.com"],
      composer: ["textarea#chat-input", "textarea"],
      send: ["div[role='button'][aria-disabled='false']:has(svg)"] },
    { id: "mistral", name: "Le Chat (Mistral)", hosts: ["chat.mistral.ai"], composer: [], send: [] },
    { id: "grok", name: "Grok", hosts: ["grok.com"], composer: [], send: [] },
    { id: "poe", name: "Poe", hosts: ["poe.com"], composer: ["textarea[class*='GrowingTextArea']"], send: [] },
    { id: "meta", name: "Meta AI", hosts: ["www.meta.ai", "meta.ai"], composer: [], send: [] },
    { id: "huggingchat", name: "HuggingChat", hosts: ["huggingface.co"], composer: [], send: [] },
    { id: "notebooklm", name: "NotebookLM", hosts: ["notebooklm.google.com"], composer: [], send: [] },
  ];

  function forHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    const site = SITES.find((s) => s.hosts.includes(h)) || { id: "other", name: h || "page", hosts: [h], composer: [], send: [] };
    return {
      id: site.id,
      name: site.name,
      composer: site.composer.concat(GENERIC.composer),
      send: site.send.concat(GENERIC.send),
    };
  }

  const api = { SITES, GENERIC, forHost };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AIWardenSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
