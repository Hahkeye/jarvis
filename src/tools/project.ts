import type { ToolDefinition, ToolHandler } from "../ai";
import { readFile, writeFile, mkdir, readdir, unlink, rename } from "fs/promises";
import { join } from "path";

const PROJECTS_DIR = join(process.cwd(), "projects");

interface Project {
  name: string;
  path: string;
  description?: string;
  created: string;
  files: string[];
}

// --- Tool Definitions ---

export const listProjectsToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_projects",
    description: "List all development projects. Use this to see available projects before selecting one.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const createProjectToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_project",
    description: "Create a new development project. Provide a name and optional description.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name (e.g., 'my-app', 'api-service')",
        },
        description: {
          type: "string",
          description: "Optional project description",
        },
        template: {
          type: "string",
          enum: ["empty", "bun-ts", "express-ts", "next-js"],
          description: "Project template to start with",
          default: "empty",
        },
      },
      required: ["name"],
    },
  },
};

export const selectProjectToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "select_project",
    description: "Switch to a specific project to work on it. You must select a project before editing files.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name to select",
        },
      },
      required: ["name"],
    },
  },
};

export const deleteProjectToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "delete_project",
    description: "Delete a project and all its files. This cannot be undone.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name to delete",
        },
      },
      required: ["name"],
    },
  },
};

export const readProjectFileToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_project_file",
    description: "Read a file from the current project. You must have a project selected first.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative file path (e.g., 'src/main.ts', 'package.json')",
        },
      },
      required: ["filePath"],
    },
  },
};

export const writeProjectFileToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "write_project_file",
    description: "Write or overwrite a file in the current project. Create directories as needed.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative file path (e.g., 'src/main.ts')",
        },
        content: {
          type: "string",
          description: "File content to write",
        },
      },
      required: ["filePath", "content"],
    },
  },
};

export const listProjectFilesToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_project_files",
    description: "List all files in the current project directory. You must have a project selected first.",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory to list (default: root of project)",
          default: ".",
        },
      },
      required: [],
    },
  },
};

// --- Tool Handlers ---

// Track active project per WebSocket
const activeProjects = new Map<WebSocket, string>();

function getActiveProject(ws: WebSocket): string | undefined {
  return activeProjects.get(ws);
}

function setActiveProject(ws: WebSocket, projectName: string | undefined) {
  if (projectName) {
    activeProjects.set(ws, projectName);
  } else {
    activeProjects.delete(ws);
  }
}

function getProjectPath(ws: WebSocket, projectName: string): string {
  return join(PROJECTS_DIR, projectName);
}

// Ensure projects directory exists
async function ensureProjectsDir() {
  try {
    await mkdir(PROJECTS_DIR, { recursive: true });
  } catch (e) {
    console.error("[PROJECTS] Failed to create projects dir:", e);
  }
}

export const listProjectsToolHandler: ToolHandler["handler"] = async (
  _args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  await ensureProjectsDir();
  
  const projects: Array<{ name: string; description: string; created: string; fileCount: number }> = [];
  try {
    const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectPath = join(PROJECTS_DIR, entry.name);
        const metaFile = join(projectPath, "project.json");
        let meta: Partial<Project> = {};
        try {
          const metaContent = await readFile(metaFile, "utf-8");
          meta = JSON.parse(metaContent);
        } catch (e) { /* no metadata */ }
        
        let fileCount = 0;
        try {
          const files = await readdir(projectPath, { recursive: true });
          fileCount = files.length;
        } catch (e) { /* ignore */ }
        
        projects.push({
          name: entry.name,
          description: meta.description || "",
          created: meta.created || "Unknown",
          fileCount,
        });
      }
    }
  } catch (e) {
    console.error("[PROJECTS] Failed to list projects:", e);
  }

  const activeProject = getActiveProject(ws);
  
  // Emit structured event for frontend
  const event = {
    type: "tool_result",
    tool: "list_projects",
    result: projects.map(p => ({
      ...p,
      active: p.name === activeProject,
    })),
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }

  // Also return text for AI response
  const textResponse = projects.map(p => {
    const isActive = p.name === activeProject ? " *" : "";
    return `- ${p.name}${isActive} (${p.created})${p.description ? ` - ${p.description}` : ""}`;
  }).join("\n");

  return textResponse || "No projects found. Use create_project to get started.";
};

export const createProjectToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const name = typeof args.name === "string" ? args.name : "";
  const description = typeof args.description === "string" ? args.description : "";
  const template = typeof args.template === "string" ? args.template : "empty";
  
  if (!name) return "Project name is required.";
  
  await ensureProjectsDir();
  
  const projectPath = getProjectPath(ws, name);
  
  try {
    await mkdir(projectPath, { recursive: true });
    
    // Write project metadata
    const meta: Project = {
      name,
      path: projectPath,
      description,
      created: new Date().toISOString(),
      files: [],
    };
    await writeFile(join(projectPath, "project.json"), JSON.stringify(meta, null, 2));
    
    // Generate template files
    if (template === "bun-ts") {
      await writeFile(join(projectPath, "package.json"), JSON.stringify({
        name,
        version: "0.0.1",
        scripts: {
          start: "bun src/index.ts",
          dev: "bun --watch src/index.ts",
        },
        dependencies: {},
        devDependencies: {
          typescript: "^5.0.0",
          "@types/node": "^20.0.0",
        },
      }, null, 2));
      
      await writeFile(join(projectPath, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      }, null, 2));
      
      await mkdir(join(projectPath, "src"), { recursive: true });
      await writeFile(join(projectPath, "src", "index.ts"), `console.log("Hello from ${name}!");\n`);
    } else if (template === "express-ts") {
      await writeFile(join(projectPath, "package.json"), JSON.stringify({
        name,
        version: "0.0.1",
        scripts: {
          start: "bun src/index.ts",
          dev: "bun --watch src/index.ts",
        },
        dependencies: {
          express: "^4.18.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "@types/express": "^4.17.0",
          "@types/node": "^20.0.0",
        },
      }, null, 2));
      
      await mkdir(join(projectPath, "src"), { recursive: true });
      await writeFile(join(projectPath, "src", "index.ts"), `import express from "express";\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.get("/", (req, res) => {\n  res.json({ message: "Hello from ${name}!" });\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server running on http://localhost:\${PORT}\`);\n});\n`);
    } else if (template === "next-js") {
      await writeFile(join(projectPath, "package.json"), JSON.stringify({
        name,
        version: "0.0.1",
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
        },
        dependencies: {
          next: "^14.0.0",
          react: "^18.0.0",
          "react-dom": "^18.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "@types/react": "^18.0.0",
          "@types/node": "^20.0.0",
        },
      }, null, 2));
      
      await mkdir(join(projectPath, "src", "app"), { recursive: true });
      await writeFile(join(projectPath, "src", "app", "layout.tsx"), `export const metadata = {\n  title: "${name}",\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html>\n      <body>{children}</body>\n    </html>\n  );\n}\n`);
      await writeFile(join(projectPath, "src", "app", "page.tsx"), `export default function Home() {\n  return <h1>Welcome to ${name}</h1>;\n}\n`);
    }
    
    // Set as active project
    setActiveProject(ws, name);
    
    // Emit structured event for frontend
    const event = {
      type: "tool_result",
      tool: "create_project",
      result: { name, template, description },
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
    
    return `Project "${name}" created successfully with "${template}" template.\n\nFiles created:\n- package.json\n- tsconfig.json\n- src/index.ts (or equivalent)\n\nThe project is now active. You can start editing files.`;
  } catch (e) {
    console.error("[PROJECTS] Failed to create project:", e);
    return `Failed to create project "${name}": ${String(e)}`;
  }
};

export const selectProjectToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const name = typeof args.name === "string" ? args.name : "";
  
  if (!name) return "Project name is required.";
  
  const projectPath = getProjectPath(ws, name);
  
  try {
    await readdir(projectPath);
    setActiveProject(ws, name);
    return `Switched to project "${name}". You can now read and write files.`;
  } catch (e) {
    return `Project "${name}" not found. Use list_projects to see available projects.`;
  }
};

export const deleteProjectToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const name = typeof args.name === "string" ? args.name : "";
  
  if (!name) return "Project name is required.";
  
  const projectPath = getProjectPath(ws, name);
  
  try {
    const { rm } = await import("fs/promises");
    await rm(projectPath, { recursive: true, force: true });
    
    // Clear active project if it was the active one
    if (getActiveProject(ws) === name) {
      setActiveProject(ws, undefined);
    }
    
    return `Project "${name}" deleted successfully.`;
  } catch (e) {
    console.error("[PROJECTS] Failed to delete project:", e);
    return `Failed to delete project "${name}": ${String(e)}`;
  }
};

export const readProjectFileToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  const activeProject = getActiveProject(ws);
  
  if (!activeProject) return "No project selected. Use select_project to choose a project first.";
  if (!filePath) return "File path is required.";
  
  const fullPath = join(getProjectPath(ws, activeProject), filePath);
  
  try {
    const content = await readFile(fullPath, "utf-8");
    return `Content of ${filePath}:\n\n${content}`;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return `File not found: ${filePath}`;
    }
    return `Failed to read file: ${String(e)}`;
  }
};

export const writeProjectFileToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  const content = typeof args.content === "string" ? args.content : "";
  const activeProject = getActiveProject(ws);
  
  if (!activeProject) return "No project selected. Use select_project to choose a project first.";
  if (!filePath) return "File path is required.";
  if (content === undefined) return "File content is required.";
  
  const fullPath = join(getProjectPath(ws, activeProject), filePath);
  
  try {
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
    return `File written successfully: ${filePath}`;
  } catch (e) {
    console.error("[PROJECTS] Failed to write file:", e);
    return `Failed to write file: ${String(e)}`;
  }
};

export const listProjectFilesToolHandler: ToolHandler["handler"] = async (
  args: Record<string, unknown>,
  ws: WebSocket,
): Promise<string> => {
  const directory = typeof args.directory === "string" ? args.directory : ".";
  const activeProject = getActiveProject(ws);
  
  if (!activeProject) return "No project selected. Use select_project to choose a project first.";
  
  const fullPath = join(getProjectPath(ws, activeProject), directory);
  
  try {
    const files = await readdir(fullPath, { withFileTypes: true });
    const items = files.map(f => ({
      name: f.name,
      type: f.isDirectory() ? "directory" : "file",
      size: "",
    }));
    
    // Emit structured event for frontend
    const event = {
      type: "tool_result",
      tool: "list_project_files",
      result: items,
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
    
    // Also return text for AI
    const textItems = files.map(f => {
      const icon = f.isDirectory() ? "📁" : "📄";
      return `${icon} ${f.name}`;
    }).join("\n");
    
    return `Files in ${directory || "."}:\n\n${textItems || "(empty directory)"}`;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return `Directory not found: ${directory}`;
    }
    return `Failed to list files: ${String(e)}`;
  }
};

// Export all handlers
export const projectTools = {
  listProjects: listProjectsToolHandler,
  createProject: createProjectToolHandler,
  selectProject: selectProjectToolHandler,
  deleteProject: deleteProjectToolHandler,
  readProjectFile: readProjectFileToolHandler,
  writeProjectFile: writeProjectFileToolHandler,
  listProjectFiles: listProjectFilesToolHandler,
};
