import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleAI } from "./ai";
import { getConfig, getPresets, updateConfig } from "./config";
import { searchToolDefinition, searchToolHandler, closeBrowser } from "./tools/search";
import { weatherToolDefinition, weatherToolHandler } from "./tools/weather";
import {
  timerToolDefinition,
  timerToolHandler,
  reminderToolDefinition,
  reminderToolHandler,
  cancelTaskToolDefinition,
  cancelTaskToolHandler,
  listTasksToolDefinition,
  listTasksToolHandler,
  cleanupTasks,
} from "./tools/timer";
import {
  listProjectsToolDefinition,
  listProjectsToolHandler,
  createProjectToolDefinition,
  createProjectToolHandler,
  selectProjectToolDefinition,
  selectProjectToolHandler,
  deleteProjectToolDefinition,
  deleteProjectToolHandler,
  readProjectFileToolDefinition,
  readProjectFileToolHandler,
  writeProjectFileToolDefinition,
  writeProjectFileToolHandler,
  listProjectFilesToolDefinition,
  listProjectFilesToolHandler,
} from "./tools/project";

const tools = [
  weatherToolDefinition,
  searchToolDefinition,
  timerToolDefinition,
  reminderToolDefinition,
  cancelTaskToolDefinition,
  listTasksToolDefinition,
  listProjectsToolDefinition,
  createProjectToolDefinition,
  selectProjectToolDefinition,
  deleteProjectToolDefinition,
  readProjectFileToolDefinition,
  writeProjectFileToolDefinition,
  listProjectFilesToolDefinition,
];

const toolHandlers = [
  { name: "get_weather", handler: weatherToolHandler },
  { name: "web_search", handler: searchToolHandler },
  { name: "set_timer", handler: timerToolHandler },
  { name: "set_reminder", handler: reminderToolHandler },
  { name: "cancel_task", handler: cancelTaskToolHandler },
  { name: "list_tasks", handler: listTasksToolHandler },
  { name: "list_projects", handler: listProjectsToolHandler },
  { name: "create_project", handler: createProjectToolHandler },
  { name: "select_project", handler: selectProjectToolHandler },
  { name: "delete_project", handler: deleteProjectToolHandler },
  { name: "read_project_file", handler: readProjectFileToolHandler },
  { name: "write_project_file", handler: writeProjectFileToolHandler },
  { name: "list_project_files", handler: listProjectFilesToolHandler },
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.split("/").slice(0, -1).join("/");
const uiDir = `${__dirname}/../ui`;

// Chat UI
const chatHtml = readFileSync(`${uiDir}/index.html`, "utf8");
const chatCss = readFileSync(`${uiDir}/styles.css`, "utf8");
const chatJs = readFileSync(`${uiDir}/app.js`, "utf8");

// Dashboard UI
const dashboardHtml = readFileSync(`${uiDir}/dashboard.html`, "utf8");
const dashboardCss = readFileSync(`${uiDir}/dashboard.css`, "utf8");
const dashboardJs = readFileSync(`${uiDir}/dashboard.js`, "utf8");

// Dev Mode UI
const devHtml = readFileSync(`${uiDir}/dev.html`, "utf8");
const devCss = readFileSync(`${uiDir}/dev.css`, "utf8");
const devJs = readFileSync(`${uiDir}/dev.js`, "utf8");

const PORT = Number(process.env.PORT) || 3000;
const HTTPS = process.env.HTTPS === "true";

const server = Bun.serve({
  port: PORT,
  tls: HTTPS ? {
    key: Bun.file("./certs/key.pem"),
    cert: Bun.file("./certs/cert.pem"),
  } : undefined,

  fetch: async (req, server) => {
    const url = new URL(req.url);

    // WebSocket endpoint — upgrade to WS
    if (url.pathname === "/ws") {
      server.upgrade(req);
      return new Response(null, { status: 101 });
    }

    // Chat UI
    if (url.pathname === "/") return new Response(chatHtml, { headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/styles.css") return new Response(chatCss, { headers: { "Content-Type": "text/css" } });
    if (url.pathname === "/app.js") return new Response(chatJs, { headers: { "Content-Type": "application/javascript" } });

    // Dashboard UI
    if (url.pathname === "/dashboard") return new Response(dashboardHtml, { headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/dashboard.css") return new Response(dashboardCss, { headers: { "Content-Type": "text/css" } });
    if (url.pathname === "/dashboard.js") return new Response(dashboardJs, { headers: { "Content-Type": "application/javascript" } });

    // Dev Mode UI
    if (url.pathname === "/dev") return new Response(devHtml, { headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/dev.css") return new Response(devCss, { headers: { "Content-Type": "text/css" } });
    if (url.pathname === "/dev.js") return new Response(devJs, { headers: { "Content-Type": "application/javascript" } });

    // API: Config
    if (url.pathname === "/api/config") {
      if (req.method === "GET") {
        return new Response(JSON.stringify(getConfig()), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (req.method === "POST") {
        const provider = await req.json();
        updateConfig(provider);
        return new Response(JSON.stringify(getConfig()), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // API: Presets
    if (url.pathname === "/api/config/presets") {
      return new Response(JSON.stringify(getPresets()), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      (ws as WebSocket & { messages: Array<{ role: string; content: string }>; isProcessing: boolean }).messages = [];
      (ws as WebSocket & { messages: Array<{ role: string; content: string }>; isProcessing: boolean }).isProcessing = false;
      console.log("[WS] connection opened");
    },

    message(ws, event: unknown) {
      const isProcessing = (ws as WebSocket & { isProcessing: boolean }).isProcessing;
      if (isProcessing) {
        console.log("[WS] message dropped — already processing");
        return;
      }

      (ws as WebSocket & { isProcessing: boolean }).isProcessing = true;

      const messages = (ws as WebSocket & { messages: Array<{ role: string; content: string }> }).messages;
      const str = typeof event === "string" ? event : String(event);
      const msg = JSON.parse(str);
      const role = typeof msg.role === "string" ? msg.role : "user";
      const content = typeof msg.content === "string" ? msg.content : "";
      messages.push({ role, content });

      console.log(`[WS] ← user: ${content.slice(0, 100)}`);
      ws.send(JSON.stringify({ type: "typing", from: "assistant" }));

      handleAI(
        messages,
        tools,
        toolHandlers,
        ws,
        (chunk: string) => ws.send(JSON.stringify({ type: "chunk", content: chunk })),
      ).then((response: string) => {
        messages.push({ role: "assistant", content: response });
        ws.send(JSON.stringify({ type: "done", from: "assistant" }));
        console.log(`[WS] → done  response=${response.slice(0, 100)}`);
      }).catch((err: unknown) => {
        console.error("[WS] AI error:", err);
        ws.send(JSON.stringify({
          type: "chunk",
          content: "Sorry, I encountered an error processing your request.",
        }));
        ws.send(JSON.stringify({ type: "done", from: "assistant" }));
      }).finally(() => {
        (ws as WebSocket & { isProcessing: boolean }).isProcessing = false;
      });
    },

    close() {
      console.log("[WS] connection closed");
    },
  },
});

console.log(`Jarvis listening on ${HTTPS ? "https" : "http"}://localhost:${PORT}`);
console.log(`  Chat:     ${HTTPS ? "https" : "http"}://localhost:${PORT}/`);
console.log(`  Dashboard: ${HTTPS ? "https" : "http"}://localhost:${PORT}/dashboard`);
if (HTTPS) {
  console.log("  Note: Self-signed certificate — accept the security warning in your browser");
}

// Graceful shutdown
async function shutdown() {
  console.log("\nShutting down...");
  cleanupTasks();
  await closeBrowser();
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
