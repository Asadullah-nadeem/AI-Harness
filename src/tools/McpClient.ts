import { spawn, ChildProcess } from "node:child_process";
import readline from "node:readline";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export class McpClient {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  private serverName: string;
  private command: string;
  private args: string[];

  constructor(serverName: string, command: string, args: string[] = []) {
    this.serverName = serverName;
    this.command = command;
    this.args = args;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          stdio: ["pipe", "pipe", "inherit"],
          shell: true,
        });

        this.process.on("error", (err) => {
          console.error(`[-] MCP Server ${this.serverName} process error:`, err);
          reject(err);
        });

        this.process.on("exit", (code) => {
          console.log(`[!] MCP Server ${this.serverName} exited with code: ${code}`);
        });

        const rl = readline.createInterface({
          input: this.process.stdout!,
          terminal: false,
        });

        rl.on("line", (line) => {
          this.handleIncomingLine(line);
        });

        // Initialize handshake
        this.sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "ai-harness-client",
            version: "1.0.0",
          },
        }).then(() => {
          this.sendNotification("notifications/initialized", {}).then(() => {
            resolve();
          });
        }).catch(reject);

      } catch (err: any) {
        reject(err);
      }
    });
  }

  private handleIncomingLine(line: string) {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message || "Unknown JSON-RPC error"));
          } else {
            pending.resolve(message.result);
          }
        }
      }
    } catch (err) {
      // Ignore parsing errors of non-JSON output (some servers print noise to stdout, though they shouldn't)
    }
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error(`MCP Client ${this.serverName} is not connected.`);
    }

    const id = this.messageId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error(`MCP Client ${this.serverName} is not connected.`);
    }

    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.process!.stdin!.write(JSON.stringify(notification) + "\n");
  }

  public async listTools(): Promise<McpTool[]> {
    try {
      const response = await this.sendRequest("tools/list", {});
      return response.tools || [];
    } catch (err) {
      console.error(`[-] Failed to list tools from MCP server ${this.serverName}:`, err);
      return [];
    }
  }

  public async callTool(name: string, args: any): Promise<any> {
    try {
      const response = await this.sendRequest("tools/call", {
        name,
        arguments: args,
      });
      return response;
    } catch (err) {
      console.error(`[-] Failed to call tool ${name} on MCP server ${this.serverName}:`, err);
      throw err;
    }
  }

  public disconnect() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
