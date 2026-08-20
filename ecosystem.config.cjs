/* eslint-disable @typescript-eslint/no-require-imports -- PM2 loads this CommonJS manifest directly. */
const fs = require("node:fs");
const path = require("node:path");

function readEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const localEnv = readEnvFile(path.join(__dirname, ".env.local"));

module.exports = {
  apps: [
    {
      name: "leadsnativa-web",
      script: ".next/standalone/server.js",
      cwd: "/opt/apps/leadsnativa",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "768M",
      min_uptime: "10s",
      max_restarts: 10,
      time: true,
      env: {
        ...localEnv,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
        SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000"
      }
    },
    {
      name: "leadsnativa-outbox",
      script: "scripts/outbox-worker.mjs",
      node_args: "--env-file=.env.local",
      cwd: "/opt/apps/leadsnativa",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "192M",
      min_uptime: "10s",
      max_restarts: 10,
      time: true,
      env: { ...localEnv, NODE_ENV: "production", OUTBOX_POLL_INTERVAL_MS: "3000" }
    }
  ]
};
