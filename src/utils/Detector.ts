import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DetectedProvider {
  provider: "openai" | "gemini" | "ollama";
  models: string[];
  available: boolean;
  notes?: string;
}

export interface DetectedMcpServer {
  name: string;
  command: string;
  args: string[];
}

export interface DetectedEnvironmentItem {
  id: string;
  name: string;
  type: "runtime" | "package_manager" | "shell";
  available: boolean;
  version?: string;
}

export interface DetectedCliTool {
  id: string;
  name: string;
  available: boolean;
  version?: string;
}

export interface DetectedProject {
  id: string;
  name: string;
  detected: boolean;
  rootPath: string;
}

export interface EnvironmentReport {
  timestamp: string;
  os: {
    platform: string;
    release: string;
    arch: string;
    cpus: number;
  };
  envKeysHash: string; // Hash or signature of current environment variables
  environments: DetectedEnvironmentItem[];
  cliTools: DetectedCliTool[];
  projects: DetectedProject[];
  providers: DetectedProvider[];
  mcpServers: DetectedMcpServer[];
  ides: string[];
  integrations: Array<{ id: string; name: string }>;
  capabilities: Array<{ id: string; name: string; active: boolean }>;
  git?: {
    branch?: string;
    remoteUrl?: string;
  };
}

export class Detector {
  private baseDir: string;
  private configDir: string;
  private localConfigPath: string;
  private defaults: any = null;

  constructor(baseDir: string = ".") {
    this.baseDir = path.resolve(baseDir);
    this.configDir = path.join(this.baseDir, "config");
    if (!fs.existsSync(this.configDir)) {
      this.configDir = path.join(__dirname, "..", "..", "config");
    }
    this.localConfigPath = path.join(this.baseDir, "data", "config", "config.json");
    this.loadDefaults();
  }

  private loadDefaults() {
    const defaultsPath = path.join(this.configDir, "defaults.json");
    if (fs.existsSync(defaultsPath)) {
      try {
        this.defaults = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
      } catch (err) {
        console.error("[-] Failed to load config/defaults.json", err);
      }
    }
  }

  private runValidationCommand(cmd: string): string | null {
    try {
      const output = execSync(cmd, {
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      return output.toString().trim().split("\n")[0] || "Installed";
    } catch {
      return null;
    }
  }

  /**
   * Generates a signature hash of relevant env keys to detect changes.
   */
  private getEnvSignature(): string {
    const keysToCheck = ["GEMINI_API_KEY", "OPENAI_API_KEY", "TERM_PROGRAM", "USER", "USERNAME"];
    const values = keysToCheck.map((k) => `${k}=${process.env[k] || ""}`).join(";");
    return values;
  }

  /**
   * Run full environment scan or load cached config if environment hasn't changed.
   */
  public async scan(): Promise<EnvironmentReport> {
    const currentSignature = this.getEnvSignature();
    
    // Check if we can load from existing cache in data/config/config.json
    if (fs.existsSync(this.localConfigPath)) {
      try {
        const cachedReport: EnvironmentReport = JSON.parse(fs.readFileSync(this.localConfigPath, "utf8"));
        
        // Compare OS and environment keys signature
        const sameOs = cachedReport.os && cachedReport.os.platform === os.platform() && cachedReport.os.arch === os.arch();
        const sameEnv = cachedReport.envKeysHash === currentSignature;
        
        if (sameOs && sameEnv) {
          console.log("[+] Loading existing configuration from local data/config/config.json (No changes detected).");
          return cachedReport;
        }
        console.log("[!] Environment changes detected, running incremental scan updates...");
      } catch {
        // Fall through to run scan
      }
    }

    // Run actual inspection
    const osReport = {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
    };

    const environments = this.detectEnvironments();
    const cliTools = this.detectCliTools();
    const projects = this.detectProjects();
    const providers = await this.detectProviders();
    const mcpServers = this.detectMcpServers();
    const ides = this.detectIDEs();
    const integrations = this.detectIntegrations();
    const git = this.inspectGitStatus(cliTools.find((t) => t.id === "git")?.available || false);
    const capabilities = this.mapCapabilities(environments, cliTools);

    const report: EnvironmentReport = {
      timestamp: new Date().toISOString(),
      os: osReport,
      envKeysHash: currentSignature,
      environments,
      cliTools,
      projects,
      providers,
      mcpServers,
      ides,
      integrations,
      capabilities,
      git: git || undefined,
    };

    // Save report to data/config/config.json
    try {
      const configDir = path.dirname(this.localConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.localConfigPath, JSON.stringify(report, null, 2), "utf8");
      console.log("[+] Generated and stored new local configuration under data/config/config.json");
    } catch (err) {
      console.error("[-] Failed to write local configuration cache:", err);
    }

    return report;
  }

  private detectEnvironments(): DetectedEnvironmentItem[] {
    const list = this.defaults?.environments || [];
    return list.map((item: any) => {
      const output = this.runValidationCommand(item.checkCommand);
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        available: output !== null,
        version: output || undefined,
      };
    });
  }

  private detectCliTools(): DetectedCliTool[] {
    const list = this.defaults?.cliTools || [];
    return list.map((item: any) => {
      const output = this.runValidationCommand(item.checkCommand);
      return {
        id: item.id,
        name: item.name,
        available: output !== null,
        version: output || undefined,
      };
    });
  }

  private detectProjects(): DetectedProject[] {
    const list = this.defaults?.projects || [];
    const projects: DetectedProject[] = [];
    const dirsToCheck = [this.baseDir, path.join(this.baseDir, "..")];

    for (const proj of list) {
      let isDetected = false;
      let detectedRoot = "";

      for (const dir of dirsToCheck) {
        const triggerMatch = proj.triggers.every((t: string) => fs.existsSync(path.join(dir, t)));
        const folderMatch = proj.folders ? proj.folders.every((f: string) => fs.existsSync(path.join(dir, f))) : true;

        if (triggerMatch && folderMatch) {
          isDetected = true;
          detectedRoot = dir;
          break;
        }
      }

      projects.push({
        id: proj.id,
        name: proj.name,
        detected: isDetected,
        rootPath: detectedRoot,
      });
    }

    return projects;
  }

  private async detectProviders(): Promise<DetectedProvider[]> {
    const parsedProviders = this.defaults?.providers || [];
    const report: DetectedProvider[] = [];

    for (const provider of parsedProviders) {
      if (provider.id === "ollama") {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1000);
          const testUrl = provider.testUrl || "http://localhost:11434/api/tags";
          const res = await fetch(testUrl, { signal: controller.signal });
          clearTimeout(timeout);

          if (res.ok) {
            const data = await res.json() as any;
            const models = (data.models || []).map((m: any) => m.name);
            report.push({
              provider: "ollama",
              models,
              available: models.length > 0,
              notes: models.length > 0 ? "Local models found." : "Ollama online, but no models found.",
            });
          }
        } catch {
          report.push({
            provider: "ollama",
            models: [],
            available: false,
            notes: "Ollama offline or not installed.",
          });
        }
      } else {
        const envKeyName = provider.envKey;
        const keyVal = envKeyName ? process.env[envKeyName] : undefined;
        report.push({
          provider: provider.id as any,
          models: provider.models || [],
          available: !!keyVal,
          notes: keyVal ? `${envKeyName} env key detected.` : `${envKeyName} not configured.`,
        });
      }
    }

    return report;
  }

  private detectMcpServers(): DetectedMcpServer[] {
    const servers: DetectedMcpServer[] = [];
    const config = this.defaults?.mcp || {};
    const pathsToSearch: string[] = [];

    const home = os.homedir();
    const appData = process.env.APPDATA || "";

    const platform = os.platform() as keyof typeof config.defaultPaths;
    const pathsForPlatform = config.defaultPaths?.[platform] || config.defaultPaths?.["linux"];

    if (pathsForPlatform) {
      for (const p of pathsForPlatform) {
        let resolved = p.replace("%APPDATA%", appData).replace("~", home);
        pathsToSearch.push(path.resolve(resolved));
      }
    }

    if (config.localConfigs) {
      for (const p of config.localConfigs) {
        pathsToSearch.push(path.resolve(this.baseDir, p));
      }
    }

    for (const confPath of pathsToSearch) {
      if (fs.existsSync(confPath)) {
        try {
          const content = fs.readFileSync(confPath, "utf8");
          const data = JSON.parse(content);
          const mcpConfig = data.mcpServers || data;

          if (mcpConfig && typeof mcpConfig === "object") {
            for (const [name, serverDetails] of Object.entries(mcpConfig)) {
              const details = serverDetails as any;
              if (details.command) {
                servers.push({
                  name,
                  command: details.command,
                  args: details.args || [],
                });
              }
            }
          }
        } catch {
          // Skip
        }
      }
    }

    return servers;
  }

  private detectIDEs(): string[] {
    const idesList = this.defaults?.ides || [];
    const ides: string[] = [];
    const dirsToInspect = [this.baseDir, path.join(this.baseDir, "..")];

    for (const target of idesList) {
      if (target.detectionFiles) {
        for (const dir of dirsToInspect) {
          for (const file of target.detectionFiles) {
            if (fs.existsSync(path.join(dir, file)) && !ides.includes(target.name)) {
              ides.push(target.name);
            }
          }
        }
      }

      if (target.envKeys) {
        for (const key of target.envKeys) {
          if (process.env[key] && !ides.includes(target.name)) {
            ides.push(target.name);
          }
        }
      }
    }

    return ides;
  }

  private detectIntegrations(): Array<{ id: string; name: string }> {
    const integrations = this.defaults?.integrations || [];
    return integrations.filter((i: any) => i.enabled).map((i: any) => ({
      id: i.id,
      name: i.name
    }));
  }

  private inspectGitStatus(gitAvailable: boolean): { branch?: string; remoteUrl?: string } | null {
    if (!gitAvailable) return null;

    try {
      const branchOutput = execSync("git branch --show-current", {
        timeout: 1000,
        cwd: this.baseDir,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).toString().trim();

      const remoteOutput = execSync("git remote get-url origin", {
        timeout: 1000,
        cwd: this.baseDir,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).toString().trim();

      let sanitizedRemote = remoteOutput;
      if (remoteOutput.includes("@")) {
        sanitizedRemote = remoteOutput.replace(/https?:\/\/.*@/, "https://[REDACTED]@");
      }

      return {
        branch: branchOutput || undefined,
        remoteUrl: sanitizedRemote || undefined,
      };
    } catch {
      return null;
    }
  }

  private mapCapabilities(
    environments: DetectedEnvironmentItem[],
    cliTools: DetectedCliTool[]
  ): Array<{ id: string; name: string; active: boolean }> {
    const capabilitiesList = this.defaults?.capabilities || [];
    return capabilitiesList.map((cap: any) => {
      let active = true;

      if (cap.requiredRuntimes) {
        active = active && cap.requiredRuntimes.every((r: string) => 
          environments.some((env) => env.id === r && env.available)
        );
      }

      if (cap.requiredTools) {
        active = active && cap.requiredTools.every((t: string) => 
          cliTools.some((tool) => tool.id === t && tool.available)
        );
      }

      return {
        id: cap.id,
        name: cap.name,
        active,
      };
    });
  }
}
