import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CONFIG_FILE = "./config.json";

export interface AIProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  icon: string;
}

const PRESETS: AIProvider[] = [
  { name: "Local llama.cpp", baseUrl: "http://localhost:8080/v1", apiKey: "", model: "llama3.2", icon: "🤖" },
  { name: "Ollama", baseUrl: "http://localhost:11434/v1", apiKey: "ollama", model: "llama3.2", icon: "🦙" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-...", model: "gpt-4o-mini", icon: "🟢" },
  { name: "LM Studio", baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio", model: "local", icon: "💻" },
  { name: "Mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "", model: "mistral-small", icon: "🔵" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "", model: "llama3-70b-8192", icon: "⚡" },
  { name: "Custom", baseUrl: "", apiKey: "", model: "", icon: "⚙️" },
];

let config: AIProvider = PRESETS[0]; // default

function loadConfig(): AIProvider | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    if (data.baseUrl && data.model) return data as AIProvider;
  } catch (e) {
    console.error("[CONFIG] Failed to load config:", e);
  }
  return null;
}

export function getConfig(): AIProvider {
  return config;
}

export function getPresets(): AIProvider[] {
  return PRESETS;
}

export function updateConfig(provider: AIProvider): void {
  config = provider;
  writeFileSync(CONFIG_FILE, JSON.stringify(provider, null, 2));
  console.log(`[CONFIG] Updated AI provider: ${provider.name} (${provider.baseUrl})`);
}

// Load config on startup
const loaded = loadConfig();
if (loaded) {
  config = loaded;
  console.log(`[CONFIG] Loaded AI provider: ${loaded.name}`);
} else {
  console.log(`[CONFIG] Using default AI provider: ${config.name}`);
}
