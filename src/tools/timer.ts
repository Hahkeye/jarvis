import type { ToolDefinition, ToolHandler } from "../ai";

interface ScheduledTask {
  id: string;
  type: "timer" | "reminder";
  message: string;
  trigger: Date;
  ws: WebSocket;
  timerId: ReturnType<typeof setTimeout> | null;
  completed: boolean;
}

const tasks = new Map<string, ScheduledTask>();
let nextId = 0;

function scheduleTask(
  type: "timer" | "reminder",
  message: string,
  trigger: Date,
  ws: WebSocket,
): ScheduledTask {
  const id = `task_${nextId++}`;
  const task: ScheduledTask = {
    id,
    type,
    message,
    trigger,
    ws,
    timerId: null,
    completed: false,
  };

  const delay = trigger.getTime() - Date.now();

  if (delay <= 0) {
    task.completed = true;
    tasks.set(id, task);
    return task;
  }

  task.timerId = setTimeout(() => {
    if (task.completed) return;
    task.completed = true;
    tasks.delete(id);
    if (task.timerId) clearTimeout(task.timerId);

    const notification = {
      type: "notification",
      from: "assistant",
      taskType: task.type,
      message: task.message,
      id: task.id,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(notification));
    } else {
      console.warn(`WebSocket closed, could not deliver ${task.type}: ${task.message}`);
    }
  }, delay);

  tasks.set(id, task);
  return task;
}

function cancelTask(id: string, ws: WebSocket): ScheduledTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.timerId) clearTimeout(task.timerId);
  task.completed = true;
  tasks.delete(id);
  return task;
}

function listTasks(ws: WebSocket): ScheduledTask[] {
  const clientTasks: ScheduledTask[] = [];
  for (const [, task] of tasks) {
    if (!task.completed && task.ws === ws) {
      clientTasks.push(task);
    }
  }
  return clientTasks;
}

// --- Tool Definitions ---

export const timerToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "set_timer",
    description: "Set a timer that will notify the user when it expires. Use duration_seconds for exact seconds (e.g. 300 for 5 minutes), or use duration_description for natural language (e.g. '5 minutes', '1 hour and 30 minutes'). If duration_seconds is provided, it takes priority.",
    parameters: {
      type: "object",
      properties: {
        duration_seconds: {
          type: "number",
          description: "Timer duration in seconds (e.g. 300 for 5 minutes)",
        },
        duration_description: {
          type: "string",
          description: "Natural language timer description (e.g. '5 minutes', '1 hour', '30 seconds')",
        },
        message: {
          type: "string",
          description: "Optional label for the timer (e.g. 'cook pasta')",
        },
      },
      required: [],
    },
  },
};

export const reminderToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "set_reminder",
    description: "Set a reminder for a specific time in the future. Use time_string for relative times (e.g. 'in 10 minutes', 'for 1 hour', 'in 30 seconds') or absolute times (e.g. 'at 3pm', 'at noon', '2025-07-15T09:00:00'). The message parameter describes what the reminder is about.",
    parameters: {
      type: "object",
      properties: {
        time_string: {
          type: "string",
          description: "When the reminder should fire (e.g. 'in 10 minutes', 'for 1 hour', 'at 3pm', 'at noon', '2025-07-15T09:00:00')",
        },
        scheduled_time: {
          type: "string",
          description: "ISO 8601 date-time string for absolute time (e.g. '2025-07-15T09:00:00')",
        },
        message: {
          type: "string",
          description: "What to remind the user about (e.g. 'take a break', 'call mom', 'stretch')",
        },
      },
      required: ["message"],
    },
  },
};

export const cancelTaskToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "cancel_task",
    description: "Cancel a previously set timer or reminder. The id parameter must be the task ID returned when the timer or reminder was created (e.g. 'task_0', 'task_1'). Use list_tasks to see all active task IDs.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task ID to cancel (e.g. 'task_0')",
        },
      },
      required: ["id"],
    },
  },
};

export const listTasksToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_tasks",
    description: "List all active timers and reminders for the current user. Optionally filter by type ('timer' or 'reminder') or task ID.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["timer", "reminder"],
          description: "Filter by task type (optional)",
        },
        id: {
          type: "string",
          description: "Filter by specific task ID (e.g. 'task_0')",
        },
      },
      required: [],
    },
  },
};

// --- Natural language duration parser ---
function parseDuration(description: string): number | null {
  const lower = description.toLowerCase().trim();

  const patterns: Array<{ regex: RegExp; multiplier: number }> = [
    { regex: /(?:(\d+)\s*h(our)?s?)\b/g, multiplier: 3600 },
    { regex: /(?:(\d+)\s*min(?:ute)?s?)\b/g, multiplier: 60 },
    { regex: /(?:(\d+)\s*sec(?:ond)?s?)\b/g, multiplier: 1 },
  ];

  let total = 0;
  let found = false;

  for (const { regex, multiplier } of patterns) {
    let match;
    while ((match = regex.exec(description)) !== null) {
      const val = parseInt(match[1], 10);
      if (!isNaN(val)) {
        total += val * multiplier;
        found = true;
      }
    }
  }

  if (!found) {
    const simpleMatch = lower.match(/^\s*(?:in\s+)?(\d+)\s*(second|minute|hour)/);
    if (simpleMatch) {
      const val = parseInt(simpleMatch[1], 10);
      const unit = simpleMatch[2];
      if (unit.startsWith("hour")) return val * 3600;
      if (unit.startsWith("min")) return val * 60;
      return val;
    }
  }

  return found ? total : null;
}

// --- Natural language time parser ---
function parseTime(timeString: string): Date | null {
  const lower = timeString.toLowerCase().trim();
  const now = new Date();

  if (lower === "noon" || lower === "at noon") {
    const result = new Date(now);
    result.setHours(12, 0, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  if (lower === "midnight" || lower === "at midnight") {
    const result = new Date(now);
    result.setHours(0, 0, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  const inMatch = lower.match(/^in\s+(\d+)\s*(second|minute|hour)s?/);
  if (inMatch) {
    const val = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const result = new Date(now);
    if (unit.startsWith("hour")) result.setHours(result.getHours() + val);
    else if (unit.startsWith("min")) result.setMinutes(result.getMinutes() + val);
    else result.setSeconds(result.getSeconds() + val);
    return result;
  }

  // Handle "for X minutes/hours" or just "X minutes/hours"
  const forMatch = lower.match(/^(?:for\s+)?(\d+)\s*(second|minute|hour)s?\b/);
  if (forMatch) {
    const val = parseInt(forMatch[1], 10);
    const unit = forMatch[2];
    const result = new Date(now);
    if (unit.startsWith("hour")) result.setHours(result.getHours() + val);
    else if (unit.startsWith("min")) result.setMinutes(result.getMinutes() + val);
    else result.setSeconds(result.getSeconds() + val);
    return result;
  }

  const atMatch = lower.match(/^at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (atMatch) {
    let hours = parseInt(atMatch[1], 10);
    const minutes = parseInt(atMatch[2], 10);
    const ampm = atMatch[3];
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    const result = new Date(now);
    result.setHours(hours, minutes, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  const directMatch = lower.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (directMatch) {
    let hours = parseInt(directMatch[1], 10);
    const minutes = parseInt(directMatch[2], 10);
    const ampm = directMatch[3];
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    const result = new Date(now);
    result.setHours(hours, minutes, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  const parsed = new Date(timeString);
  if (!isNaN(parsed.getTime()) && parsed > now) return parsed;

  return null;
}

// --- Tool Handlers ---

export const timerToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const durationSeconds = typeof args.duration_seconds === "number" ? args.duration_seconds : undefined;
  const durationDescription = typeof args.duration_description === "string" ? args.duration_description : undefined;
  const message = typeof args.message === "string" ? args.message : "";

  let trigger: Date;
  let durationSecs = 0;

  if (durationSeconds) {
    durationSecs = durationSeconds;
    trigger = new Date(Date.now() + durationSeconds * 1000);
  } else if (durationDescription) {
    const parsed = parseDuration(durationDescription);
    if (parsed === null) return "Could not parse timer duration. Please provide a duration like '5 minutes' or use duration_seconds.";
    durationSecs = parsed;
    trigger = new Date(Date.now() + parsed * 1000);
  } else {
    return "No duration provided for timer.";
  }

  if (trigger.getTime() <= Date.now()) return "Timer duration is zero or in the past.";

  const task = scheduleTask("timer", message || "Timer", trigger, ws);

  // Emit structured event for dashboard
  const event = {
    type: "tool_result",
    tool: "set_timer",
    result: {
      id: task.id,
      label: message || "Timer",
      durationSeconds: durationSecs,
      triggerTime: trigger.getTime(),
    },
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }

  const remaining = trigger.getTime() - Date.now();
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return `Timer set: ${message || "Timer"} for ${timeStr}. Task ID: ${task.id}. I'll notify you when it's up!`;
};

export const reminderToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const message = typeof args.message === "string" ? args.message : "";
  const timeString = typeof args.time_string === "string" ? args.time_string : undefined;
  const scheduledTime = typeof args.scheduled_time === "string" ? args.scheduled_time : undefined;

  if (!message) return "No reminder message provided.";

  let trigger: Date;

  // Fallback: if time_string looks like a duration and message is short, swap them
  if (!timeString && !scheduledTime) {
    // Check if message looks like a duration (e.g., "10 minutes", "for 1 hour")
    const durationPattern = /^(?:for\s+)?\d+\s*(second|minute|hour)s?\b/i;
    if (durationPattern.test(message) && message.length < 30) {
      // Likely the user said "remind me for 10 minutes" and the LLM put the duration in message
      const parsed = parseTime(message);
      if (parsed) {
        trigger = parsed;
        // Schedule the task and return
        const task = scheduleTask("reminder", "Reminder", trigger, ws);
        const remaining = trigger.getTime() - Date.now();
        const hours = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        let timeStr = "";
        if (hours > 0) timeStr += `${hours}h `;
        if (mins > 0) timeStr += `${mins}m `;
        timeStr = timeStr.trim();
        const triggerFormatted = trigger.toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit", hour12: true,
        });
        const event = {
          type: "tool_result",
          tool: "set_reminder",
          result: {
            id: task.id,
            label: "Reminder",
            triggerTime: trigger.getTime(),
            triggerFormatted,
          },
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event));
        }
        return `Reminder set: ${message} at ${triggerFormatted} (in ${timeStr}). Task ID: ${task.id}. I'll remind you then!`;
      }
    }
  }

  if (scheduledTime) {
    trigger = new Date(scheduledTime);
    if (isNaN(trigger.getTime())) return "Invalid scheduled time. Please provide a valid ISO date-time string.";
  } else if (timeString) {
    trigger = parseTime(timeString);
    if (!trigger) return `Could not parse time "${timeString}". Please use formats like "in 10 minutes", "for 1 hour", "at 3pm", "at noon", or an ISO date-time string.`;
  } else {
    return "No time provided for the reminder. Please specify when you want to be reminded.";
  }

  if (trigger.getTime() <= Date.now()) {
    return "The reminder time is in the past. Please set a future time.";
  }

  const task = scheduleTask("reminder", message, trigger, ws);

  // Emit structured event for dashboard
  const triggerFormatted = trigger.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const event = {
    type: "tool_result",
    tool: "set_reminder",
    result: {
      id: task.id,
      label: message,
      triggerTime: trigger.getTime(),
      triggerFormatted,
    },
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }

  const remaining = trigger.getTime() - Date.now();
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);

  let timeStr = "";
  if (hours > 0) timeStr += `${hours}h `;
  if (mins > 0) timeStr += `${mins}m `;
  timeStr = timeStr.trim();

  return `Reminder set: "${message}" at ${triggerFormatted} (in ${timeStr}). Task ID: ${task.id}. I'll remind you then!`;
};

export const cancelTaskToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const id = typeof args.id === "string" ? args.id : undefined;
  if (!id) return "No task ID provided. Please provide the task ID to cancel.";

  const task = cancelTask(id, ws);
  if (!task) return `Task "${id}" not found. It may have already expired or been cancelled.`;

  // Emit structured event for dashboard
  const event = {
    type: "tool_result",
    tool: "cancel_task",
    result: {
      id: task.id,
      taskType: task.type,
      label: task.message,
    },
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }

  return `Cancelled ${task.type}: "${task.message}" (${task.id}).`;
};

export const listTasksToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const filterType = typeof args.type === "string" ? args.type : undefined;
  const filterId = typeof args.id === "string" ? args.id : undefined;
  
  let clientTasks = listTasks(ws);
  
  // Apply filters
  if (filterType) {
    clientTasks = clientTasks.filter(t => t.type === filterType);
  }
  if (filterId) {
    clientTasks = clientTasks.filter(t => t.id === filterId);
  }

  // Emit structured event for dashboard
  const event = {
    type: "tool_result",
    tool: "list_tasks",
    result: {
      timers: clientTasks
        .filter(t => t.type === "timer")
        .map(t => ({ id: t.id, label: t.message, triggerTime: t.trigger.getTime() })),
      reminders: clientTasks
        .filter(t => t.type === "reminder")
        .map(t => ({
          id: t.id,
          label: t.message,
          triggerTime: t.trigger.getTime(),
          triggerFormatted: t.trigger.toLocaleString("en-US", {
            weekday: "short", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: true,
          }),
        })),
    },
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }

  if (clientTasks.length === 0) return "No active timers or reminders.";

  let result = "Active tasks:\n\n";
  for (const task of clientTasks) {
    const remaining = task.trigger.getTime() - Date.now();
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const timeStr = hours > 0
      ? `${hours}h ${mins}m ${secs}s`
      : mins > 0
        ? `${mins}m ${secs}s`
        : `${secs}s`;

    result += `- ${task.type}: "${task.message}" (${task.id}) — triggers in ${timeStr}\n`;
  }

  return result.trim();
};

// Cleanup on shutdown
export function cleanupTasks() {
  for (const [, task] of tasks) {
    if (task.timerId) clearTimeout(task.timerId);
  }
  tasks.clear();
}
