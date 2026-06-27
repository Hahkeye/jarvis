import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolHandler {
  name: string;
  handler: (args: Record<string, unknown>, ws: WebSocket) => Promise<string>;
}

export interface Message {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function getCurrentTime(): string {
  return new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

function buildSystemPrompt(): string {
  const now = getCurrentTime();
  return `You are Jarvis, a helpful home assistant AI. You are friendly, concise, and helpful.

Current date and time: ${now}

You have access to the following tools:
- get_weather: Get current weather for a city
- web_search: Search the web for information
- set_timer: Set a countdown timer (e.g. "set a 5 minute timer to cook pasta")
- set_reminder: Set a reminder for a specific time (e.g. "remind me at 3pm to take a break")
- cancel_task: Cancel a timer or reminder by its task ID
- list_tasks: List all active timers and reminders

Use tools when the user asks questions that require real-time data (weather, search) or wants timers/reminders. Otherwise, answer directly.`;
}

async function streamToCompletion(
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; arguments: string }> }> {
  const aiConfig = getConfig();
  const apiUrl = aiConfig.baseUrl;
  const apiKey = aiConfig.apiKey;
  const model = aiConfig.model;

  console.log(`[AI] → ${apiUrl}/chat/completions  model=${model}  messages=${body.messages?.length || 0}  provider=${aiConfig.name}`);
  const start = Date.now();

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`[AI] ✗ HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    throw new Error(`AI API error: ${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  let fullContent = "";
  let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;

        if (delta?.content) {
          fullContent += delta.content;
          onChunk(delta.content);
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: "", name: "", arguments: "" };
            }
            if (tc.id) toolCalls[idx].id += tc.id;
            if (tc.function?.name) toolCalls[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  const elapsed = Date.now() - start;
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      console.log(`[AI] ← ${elapsed}ms  tool_call: ${tc.name}(${tc.arguments.slice(0, 100)})`);
    }
  } else {
    console.log(`[AI] ← ${elapsed}ms  text: ${fullContent.slice(0, 100)}...`);
  }

  return { content: fullContent, toolCalls };
}

export async function handleAI(
  messages: Message[],
  tools: ToolDefinition[],
  toolHandlers: ToolHandler[],
  ws: WebSocket,
  onChunk: (text: string) => void,
): Promise<string> {
  const maxToolTurns = 5;
  let toolTurns = 0;
  let allMessages = [...messages];
  const totalStart = Date.now();

  console.log(`[AI] === handleAI start  user_messages=${messages.length}`);

  while (toolTurns < maxToolTurns) {
    console.log(`[AI] --- tool turn ${toolTurns + 1}/${maxToolTurns}  context=${allMessages.length} messages`);
    const systemPrompt = buildSystemPrompt();
    const aiConfig = getConfig();
    const body: Record<string, unknown> = {
      model: aiConfig.model || "llama3.2",
      messages: [{ role: "system", content: systemPrompt }, ...allMessages],
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const { content, toolCalls } = await streamToCompletion(body, onChunk);

    if (toolCalls.length === 0) {
      const totalElapsed = Date.now() - totalStart;
      console.log(`[AI] === handleAI done  ${totalElapsed}ms  ${toolTurns} tool turn(s)`);
      return content;
    }

    // Execute tool calls and append results
    for (const tc of toolCalls) {
      allMessages.push({
        role: "assistant",
        content: "",
        tool_calls: [{ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } }],
      });

      let result: string;
      try {
        const handler = toolHandlers.find((h) => h.name === tc.name);
        if (handler) {
          const args = JSON.parse(tc.arguments);
          console.log(`[TOOL] executing ${tc.name}  args=${tc.arguments.slice(0, 150)}`);
          const toolStart = Date.now();
          result = await handler.handler(args, ws);
          const toolElapsed = Date.now() - toolStart;
          console.log(`[TOOL] ${tc.name} done  ${toolElapsed}ms  result=${result.slice(0, 150)}`);
        } else {
          result = `Unknown tool: ${tc.name}`;
          console.warn(`[TOOL] ✗ unknown tool: ${tc.name}`);
        }
      } catch (e) {
        result = `Error executing ${tc.name}: ${String(e)}`;
        console.error(`[TOOL] ✗ ${tc.name} error: ${String(e)}`);
      }

      allMessages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }

    toolTurns++;
  }

  const totalElapsed = Date.now() - totalStart;
  console.error(`[AI] ✗ exceeded max tool turns (${maxToolTurns}) in ${totalElapsed}ms`);
  return `Sorry, I exceeded the maximum number of tool calls (${maxToolTurns}) without resolving your request.`;
}
