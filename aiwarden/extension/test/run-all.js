"use strict";
// Entry point for `node --test extension/` (Node resolves the directory through package.json "main").
const fs = require("node:fs");
const path = require("node:path");
for (const f of fs.readdirSync(__dirname).sort()) {
  if (f.endsWith(".test.js")) require(path.join(__dirname, f));
}
