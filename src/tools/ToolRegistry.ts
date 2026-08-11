import { McpClient, McpTool } from "./McpClient.js";
import fs from "node:fs";
import path from "node:path";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any> | any;
}

export class ToolRegistry {
  private localTools = new Map<string, ToolDefinition>();
  private mcpClients: McpClient[] = [];
  private mcpTools = new Map<string, { client: McpClient; tool: McpTool }>();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    // 1. Read File Tool
    this.registerLocalTool({
      name: "read_file",
      description: "Read the content of a file on disk relative to the current workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read" },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const fullPath = path.resolve(args.path);
        if (!fs.existsSync(fullPath)) {
          return { error: `File not found: ${args.path}` };
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          return { error: `Path is a directory, not a file: ${args.path}` };
        }
        const content = fs.readFileSync(fullPath, "utf8");
        return { content };
      },
    });

    // 2. Write File Tool
    this.registerLocalTool({
      name: "write_file",
      description: "Write content to a file on disk relative to the current workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to write the file to" },
          content: { type: "string", description: "Content to write into the file" },
        },
        required: ["path", "content"],
      },
      handler: async (args: { path: string; content: string }) => {
        const fullPath = path.resolve(args.path);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, args.content, "utf8");
        return { success: true, path: args.path };
      },
    });

    // 3. List Directory Tool
    this.registerLocalTool({
      name: "list_directory",
      description: "List the contents of a directory on disk relative to the current workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the directory, defaults to current directory" },
        },
      },
      handler: async (args: { path?: string }) => {
        const dirPath = path.resolve(args.path || ".");
        if (!fs.existsSync(dirPath)) {
          return { error: `Directory not found: ${args.path || "."}` };
        }
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
          return { error: `Path is a file, not a directory: ${args.path || "."}` };
        }
        const files = fs.readdirSync(dirPath);
        const results = files.map((file) => {
          const fp = path.join(dirPath, file);
          const fstat = fs.statSync(fp);
          return {
            name: file,
            type: fstat.isDirectory() ? "directory" : "file",
            size: fstat.size,
          };
        });
        return { directory: dirPath, contents: results };
      },
    });
  }

  public registerLocalTool(tool: ToolDefinition) {
    this.localTools.set(tool.name, tool);
  }

  public async registerMcpServer(serverName: string, command: string, args: string[] = []): Promise<void> {
    const client = new McpClient(serverName, command, args);
    try {
      await client.connect();
      this.mcpClients.push(client);
      const tools = await client.listTools();
      for (const tool of tools) {
        // Namespace the tool name to avoid conflicts, e.g., stitch_list_projects
        const namespacedName = `${serverName.toLowerCase()}_${tool.name}`;
        this.mcpTools.set(namespacedName, { client, tool });
      }
      console.log(`[+] Registered ${tools.length} tools from MCP Server: ${serverName}`);
    } catch (err) {
      console.error(`[-] Failed to connect to MCP Server: ${serverName}`, err);
    }
  }

  public getToolSchemas(): any[] {
    const schemas: any[] = [];

    // Local tools schema mapping
    for (const tool of this.localTools.values()) {
      schemas.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      });
    }

    // MCP tools schema mapping
    for (const [name, { tool }] of this.mcpTools.entries()) {
      schemas.push({
        name: name,
        description: tool.description || "",
        input_schema: tool.inputSchema,
      });
    }

    return schemas;
  }

  public async executeTool(name: string, args: any): Promise<any> {
    // Check local tools
    const localTool = this.localTools.get(name);
    if (localTool) {
      try {
        return await localTool.handler(args);
      } catch (err: any) {
        return { error: err.message || "Failed to execute local tool" };
      }
    }

    // Check MCP tools
    const mcpTool = this.mcpTools.get(name);
    if (mcpTool) {
      try {
        const response = await mcpTool.client.callTool(mcpTool.tool.name, args);
        return response;
      } catch (err: any) {
        return { error: err.message || "Failed to execute MCP tool" };
      }
    }

    return { error: `Tool not found: ${name}` };
  }

  public shutdown() {
    for (const client of this.mcpClients) {
      client.disconnect();
    }
  }
}
