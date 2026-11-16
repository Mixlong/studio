"use strict";
const fs = require("node:fs");
const path = require("node:path");

// This file is generated at package build time, never with an HTTP localhost default.
// The configured endpoint is public (not a token) but must be encrypted in transit.
const value = (process.env.DIGIWISE_IDE_API_BASE_URL || "").trim();
if (value) {
    let url;
    try {
        url = new URL(value);
    } catch (_error) {
        throw new Error("DIGIWISE_IDE_API_BASE_URL must be a valid HTTPS URL");
    }
    if (url.protocol !== "https:" || url.username || url.password ||
        !url.pathname.replace(/\/+$/, "").endsWith("/api/ide/v1")) {
        throw new Error("DIGIWISE_IDE_API_BASE_URL must use HTTPS and end with /api/ide/v1");
    }
}
const file = path.join(__dirname, "..", "build", "main", "ide-public-api.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ baseUrl: value || null }) + "\n");
console.log(value
    ? "Packaged IDE Public API endpoint configured"
    : "No production IDE API URL: packaged login and grey updates will remain disabled");
