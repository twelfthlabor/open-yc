# aiwarden browser guard (Chrome / Edge extension)

The browser half of aiwarden. It shows which AI chat sites people use, and warns or blocks
**before** sensitive data is sent to them: API keys and tokens, private keys, credit card numbers,
US SSNs, Canadian SINs, bulk email addresses and customer/contact lists. It also checks file uploads.

Plain JavaScript, Manifest V3, no build step, no remote code, no third-party libraries.

## Install (unpacked)

1. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `extension/` folder.
3. Optional: open the extension's **Options** to change actions per detector or connect a collector.

Covered sites: ChatGPT (chatgpt.com, chat.openai.com), Claude, Gemini, Google AI Studio, NotebookLM,
Microsoft Copilot, Perplexity, DeepSeek, Le Chat (Mistral), Grok, Poe, Meta AI and HuggingChat.
To add a site, add its origin to `content_scripts.matches` in `manifest.json` and, if the generic
selectors do not find its composer, add an adapter in `sites.js`.

## What it checks

| Detector | Default | Notes |
|---|---|---|
| Private keys, Anthropic/OpenAI/GitHub/AWS/Slack/Google/Stripe/GitLab/Hugging Face/npm tokens, JWTs, passwords in URLs, bearer tokens | block | Same patterns as `src/aiwarden/secrets.py` |
| Credential or key file (`.env`, `*.env`, `id_rsa`, `*.pem`, `*.key`, `.netrc`, `credentials`, `secrets.json`, ...) | block | By file name; `.env.example` and `*.pub` are fine |
| Credit card number | warn | Luhn check plus a card-network prefix and length |
| US SSN | warn | `123-45-6789` / `123 45 6789` with valid area/group/serial; bare 9 digits only next to "SSN"/"social security" |
| Canadian SIN | warn | Luhn check; bare 9 digits only next to "SIN"/"social insurance" |
| Many email addresses | warn | 5 or more unique addresses (configurable) |
| Customer / contact list | warn | CSV, TSV, `;`, `\|` or markdown table with at least 10 data rows (configurable) and either 2+ headers like name/email/phone/company/address, or a column that is mostly email addresses |

It checks:

- **Send**: Enter (not Shift+Enter, not during IME composition), clicks on the send button, and form submit.
- **Paste and drop**: text, and any files in the clipboard or drop.
- **File inputs**: name, size and type. Text-like files up to 1 MB are read and scanned locally. Images
  and other binary files are checked by name only, and the event records `file_inspected: false`.

**Warn** shows a dialog with *Cancel* and *Send anyway* (or *Continue anyway*). **Block** shows a
dialog that only lets you go back and edit. **Allow** lets the action through but still records
that a detector fired. Change any of these per detector in Options.

If the content script hits an error, or a site changes its markup so that no composer is found, the
action goes through (fail open). The extension is a guardrail against mistakes, not a sandbox
against a determined user.

## Privacy model

- Text, pasted content and files are scanned inside the tab. They are never stored, logged or sent anywhere.
- The detector API (`detect.js`) returns only `{kind, category, count}`. It never returns the matched value.
- An event contains only the site hostname, channel (`submit`/`paste`/`drop`/`file`), detector kinds
  and counts, action, the user's decision, a timestamp and a random event id. File events add the
  extension (`csv`), size in bytes and whether the content was inspected. There is no file name.
- Site usage is a per-day count of visits and of seconds with the tab visible and focused
  (15-second heartbeats).
- Everything is kept in `chrome.storage.local`: the last 500 events and 30 days of usage.
- If a collector URL and token are set in Options, the background worker sends a batch every
  minute to `POST <collector>/api/browser-events`. The collector also enforces this: it accepts only
  enums, ids, hostnames, timestamps and numbers, and rejects (HTTP 422) any field such as
  `prompt`, `text`, `content` or `filename`.

## Collector setup

```
AIWARDEN_TOKEN=change-me aiwarden serve --host 0.0.0.0 --port 8765
# optional: only accept calls from your extension id(s)
AIWARDEN_EXTENSION_IDS=abcdefghijklmnopabcdefghijklmnop aiwarden serve ...
```

In Options, set the collector URL and token. Optionally set a profile label, and the aiwarden device
id (`aiwarden scan --json | jq .device.id`) to link the browser profile to that device in the fleet
view. Use **Save and send now** to test the connection. The dashboard's **Browser** tab shows sites
used, time on site, DLP events, and blocks and warnings by detector.

CORS on the collector is enabled only for `/api/browser-events`, and only for
`chrome-extension://<id>` origins (or the ids in `AIWARDEN_EXTENSION_IDS`). Every other origin gets a 403.

## Development

```
node --test extension/               # detection, manifest and adapter tests (Node 20+)
python -m pytest tests/test_browser_events.py   # collector endpoint + extension/collector contract test
```

`test/e2e/composer.html` is a mock chat page that loads the content script with a stubbed `chrome`
API. Serve the folder (`python -m http.server -d extension 8799`) and open
`http://127.0.0.1:8799/test/e2e/composer.html` to try typing, pasting and uploading by hand.

## Known limits

- Site adapters rely on DOM selectors. When a site changes its markup, the generic fallback
  (`textarea`, `contenteditable`, send buttons by label) usually still works. If it doesn't, the
  extension fails open.
- *Send anyway* re-clicks the site's send button. If no send button is found, it asks you to press
  Enter again, and that one message is let through.
- File inputs that a page creates and never attaches to the document are not seen. Uploads that
  bypass the DOM (for example from a cloud drive picker) are not checked either.
- Typed text is checked when it is sent, not as each key is pressed. Text that a page sends by
  itself (for example autosaved drafts) is not intercepted.
- The extension can be disabled by the user unless it is force-installed by enterprise policy
  (`ExtensionInstallForcelist`).
