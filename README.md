# Jarvis — Home Assistant

A lightweight AI-powered home assistant built with Bun and [llama.cpp](https://github.com/ggml-org/llama.cpp). Features streaming chat, tool use (weather, web search, timers, reminders), voice input, and a smart display dashboard.

![Jarvis](screenshot.png)

## Setup

```bash
# Clone and install
cd jarvis && bun install

# Copy the env template
cp .env.example .env
```

### AI Provider

Jarvis uses an OpenAI-compatible API. Configure it in `.env`:

```env
OPENAI_BASE_URL=http://localhost:8080/v1
OPENAI_API_KEY=
OPENAI_MODEL=llama3.2
```

#### Supported Providers

| Provider | Base URL | API Key | Model |
|---|---|---|---|
| **Local llama.cpp** | `http://localhost:8080/v1` | (none) | `llama3.2` |
| **Ollama** | `http://localhost:11434/v1` | `ollama` | `llama3.2` |
| **OpenAI** | `https://api.openai.com/v1` | `sk-...` | `gpt-4o-mini` |
| **LM Studio** | `http://localhost:1234/v1` | `lm-studio` | (any local) |
| **Mistral** | `https://api.mistral.ai/v1` | `your-key` | `mistral-small` |
| **Groq** | `https://api.groq.com/openai/v1` | `your-key` | `llama3-70b` |

Any OpenAI-compatible endpoint works — just set `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

#### Running llama.cpp

```bash
# Clone and build with CUDA support
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp && mkdir build && cd build
cmake .. -DGGML_CUDA=ON -DBUILD_SHARED_LIBS=OFF
make -j$(nproc) server

# Download a GGUF model (e.g. Llama-3.2-3B-Instruct Q4_K_M from HuggingFace)

# Start the server
./server -m /path/to/model.gguf \
  --host 0.00.0.0 --port 8080 \
  --ngl 99 --n_ctx 8192 --n-batch 512
```

#### Running Ollama (alternative)

```bash
ollama run llama3.2
# Then set in .env:
# OPENAI_BASE_URL=http://localhost:11434/v1
# OPENAI_API_KEY=ollama
```

## Running

```bash
# Development (auto-reload on file changes)
bun dev

# Production
bun start
```

Then open **http://localhost:3000** in your browser.

### Runtime AI Provider Selection

Use the ⚙️ **Settings** button in the sidebar to switch between AI providers without editing `.env`:

- **Preset options**: Local llama.cpp, Ollama, OpenAI, LM Studio, Mistral, Groq, or Custom
- **Persistent**: Settings save to `config.json` and persist across restarts
- **Quick toggle**: Switch between local and remote providers dynamically

![Settings](settings-screenshot.png)

## Features

| Feature | Description |
|---|---|
| **Chat** | Streaming responses via WebSocket with Markdown link rendering |
| **Weather** | Current weather for any city (via Open-Meteo) |
| **Web Search** | DuckDuckGo HTML search via Puppeteer |
| **Timers** | "Set a 5 minute timer" — countdown with toast + browser notification |
| **Reminders** | "Remind me at 3pm to call mom" — scheduled alerts |
| **Voice Input** | Microphone button uses Web Speech API for hands-free chat |
| **Stop Generation** | Send button becomes Stop while streaming |
| **Multi-turn tools** | AI can chain multiple tool calls in a single conversation |

## Tool Use Examples

```
"What's the weather in Tokyo?"
→ Calls get_weather → Returns current conditions

"Set a timer for 2 hours"
→ Calls set_timer → Toast fires when done

"Remind me in 30 minutes to stretch"
→ Calls set_reminder → Toast + browser notification

"What timers do I have?"
→ Calls list_tasks → Lists all active timers/reminders

"Cancel task_0"
→ Calls cancel_task → Removes the scheduled task
```

## Project Structure

```
├── src/
│   ├── server.ts        # HTTP + WebSocket server (Bun.serve)
│   ├── ai.ts            # AI streaming handler, system prompt, tool call loop
│   └── tools/
│       ├── index.ts     # Re-exports
│       ├── weather.ts   # Weather tool (Open-Meteo API)
│       ├── search.ts    # Web search tool (Puppeteer + DuckDuckGo)
│       └── timer.ts     # Timers & reminders (setTimeout scheduler)
├── ui/
│   ├── index.html       # Chat UI
│   ├── styles.css       # Tailwind-inspired dark theme
│   └── app.js           # Frontend: WebSocket, streaming, voice, toasts
├── .env.example         # Environment template
├── tsconfig.json        # TypeScript config
└── package.json
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **AI:** OpenAI-compatible API (llama.cpp, Ollama, OpenAI, Mistral, Groq, LM Studio)
- **Search:** Puppeteer + DuckDuckGo HTML
- **Weather:** Open-Meteo (no API key needed)
- **Voice:** Web Speech API

## Browser Requirements

- Web Speech API support (Chrome, Edge, Safari) for voice input
- WebSocket support (all modern browsers)
- Notification permission (optional, for desktop reminders)
