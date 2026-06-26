import type { ToolDefinition, ToolHandler } from "../ai";
import { launch } from "puppeteer";

let browserInstance: ReturnType<typeof launch> | null = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;
  browserInstance = await launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export const searchToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
};

export async function searchToolHandler(args: Record<string, unknown>, _ws: WebSocket): Promise<string> {
  const query = typeof args.query === "string" ? args.query : "";
  console.log(`[SEARCH] query: ${query}`);
  if (!query) return "No search query provided";

  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    await page.waitForSelector(".result__body");

    const snippets = await page.evaluate(() => {
      const results = Array.from(document.querySelectorAll(".result__body a"));
      return results.slice(0, 5).map((a) => {
        const text = a.textContent?.trim() || "";
        const href = a.href;
        return { text, url: href };
      });
    });

    // Emit structured event for dashboard
    const event = {
      type: "tool_result",
      tool: "web_search",
      result: {
        query,
        results: snippets,
      },
    };
    if (_ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(event));
    }

    console.log(`[SEARCH] found ${snippets.length} results`);
    return snippets.map((s: { text: string; url: string }) => `[${s.text}](${s.url})`).join("\n\n");
  } catch (e) {
    console.error(`[SEARCH] failed: ${String(e)}`);
    return `Search failed: ${String(e)}`;
  } finally {
    await page?.close();
  }
}
