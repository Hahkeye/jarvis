import type { ToolDefinition, ToolHandler } from "../ai";

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export const weatherToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather for a city",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name" },
      },
      required: ["city"],
    },
  },
};

export async function weatherToolHandler(args: Record<string, unknown>, ws: WebSocket): Promise<string> {
  const city = typeof args.city === "string" ? args.city : "";
  console.log(`[WEATHER] query: ${city}`);
  if (!city) return "No city provided";

  // Geocode
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) { console.error(`[WEATHER] geocode failed: ${geoRes.status}`); return "Failed to locate city"; }

  const geoData = await geoRes.json();
  const results = geoData.results;
  if (!results || results.length === 0) { console.warn(`[WEATHER] city not found: ${city}`); return `City "${city}" not found`; }

  const { latitude, longitude, name } = results[0];

  // Weather
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
  const weatherRes = await fetch(weatherUrl);
  if (!weatherRes.ok) { console.error(`[WEATHER] weather API failed: ${weatherRes.status}`); return "Failed to fetch weather"; }

  const weatherData = await weatherRes.json();
  const current = weatherData.current;
  const weather = WEATHER_CODES[current.weather_code] || `Code ${current.weather_code}`;

  // Emit structured event for dashboard
  const event = {
    type: "tool_result",
    tool: "get_weather",
    result: {
      location: name,
      temp: String(current.temperature_2m),
      unit: "C",
      condition: weather,
      humidity: String(current.relative_humidity_2m),
      wind: String(current.wind_speed_10m),
    },
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }

  return `Weather in ${name}: ${current.temperature_2m}°C, ${weather}, Humidity ${current.relative_humidity_2m}%, Wind ${current.wind_speed_10m} km/h`;
}
