import { PromptManager } from "./prompt/PromptManager.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";
import { MemoryManager, ChatMessage } from "./memory/MemoryManager.js";
import { ModelProvider, ModelConfig, ModelResponse } from "./model/ModelProvider.js";
import { Evaluator } from "./evaluation/Evaluator.js";
import { Guardrails } from "./guardrails/Guardrails.js";
import { OutputHandler, HarnessOutput } from "./output/OutputHandler.js";
import fs from "node:fs";
import path from "node:path";
import { Detector, EnvironmentReport } from "./utils/Detector.js";

export interface HarnessConfig {
  model?: ModelConfig;
  baseDir?: string;
  maxToolLoops?: number;
  runSelfEvaluation?: boolean;
}

export class Harness {
  public prompt: PromptManager;
  public guardrails: Guardrails;
  public memory: MemoryManager;
  public tools: ToolRegistry;
  public model!: ModelProvider;
  public evaluation: Evaluator;
  public output: OutputHandler;
  public detector: Detector;
  public envReport?: EnvironmentReport;

  private config: HarnessConfig;
  private initialized = false;

  constructor(config: HarnessConfig = {}) {
    this.config = config;
    this.prompt = new PromptManager();
    this.guardrails = new Guardrails();
    this.memory = new MemoryManager(config.baseDir);
    this.tools = new ToolRegistry();
    this.evaluation = new Evaluator();
    this.output = new OutputHandler();
    this.detector = new Detector(config.baseDir);
    
    if (config.model) {
      this.model = new ModelProvider(config.model);
      this.initialized = true;
    }
  }

  /**
   * Run environment discovery and configure available systems
   */
  public async autoConfigure(): Promise<void> {
    if (this.initialized) return;

    console.log("🔍 Scanning environment for AI models, MCP servers, and IDE settings...");
    this.envReport = await this.detector.scan();


    // Output detailed environment logs
    console.log(`[+] Operating System: ${this.envReport.os.platform} (${this.envReport.os.arch}) - CPU Cores: ${this.envReport.os.cpus}`);
    
    const activeEnvs = this.envReport.environments.filter((e) => e.available).map((e) => `${e.name} (${e.version})`);
    if (activeEnvs.length > 0) {
      console.log(`[+] Detected runtimes & shells: ${activeEnvs.join(", ")}`);
    }

    const activeTools = this.envReport.cliTools.filter((t) => t.available).map((t) => t.name);
    if (activeTools.length > 0) {
      console.log(`[+] Detected CLI tools: ${activeTools.join(", ")}`);
    }

    if (this.envReport.git) {
      console.log(`[+] Git branch: ${this.envReport.git.branch || "unknown"} (Remote: ${this.envReport.git.remoteUrl || "local-only"})`);
    }

    const activeProjects = this.envReport.projects.filter((p) => p.detected).map((p) => p.name);
    if (activeProjects.length > 0) {
      console.log(`[+] Project footprint: ${activeProjects.join(", ")}`);
    }

    const activeCaps = this.envReport.capabilities.filter((c) => c.active).map((c) => c.name);
    if (activeCaps.length > 0) {
      console.log(`[+] Capability Map: ${activeCaps.join(", ")}`);
    }

    // 1. Configure Model
    if (!this.config.model) {
      const activeProvider = this.envReport.providers.find((p) => p.available);
      if (activeProvider) {
        let modelName = "";
        if (activeProvider.provider === "gemini") {
          modelName = "gemini-1.5-flash";
        } else if (activeProvider.provider === "openai") {
          modelName = "gpt-4o-mini";
        } else if (activeProvider.provider === "ollama") {
          modelName = activeProvider.models[0] || "qwen2.5-coder";
        }

        console.log(`[+] Auto-detected AI provider: ${activeProvider.provider} (using ${modelName})`);
        this.model = new ModelProvider({
          provider: activeProvider.provider,
          modelName: modelName,
          apiKey: activeProvider.provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
        });
      } else {
        console.warn("[-] No AI providers available or credentials provided. Attempting default Ollama connection.");
        this.model = new ModelProvider({
          provider: "ollama",
          modelName: "qwen2.5-coder",
        });
      }
    }

    // 2. Register MCP Servers
    if (this.envReport.mcpServers.length > 0) {
      console.log(`[+] Auto-detected ${this.envReport.mcpServers.length} MCP configurations. Connecting...`);
      for (const mcp of this.envReport.mcpServers) {
        await this.addMcpServer(mcp.name, mcp.command, mcp.args);
      }
    }

    // 3. Log IDE rules found
    if (this.envReport.ides.length > 0) {
      console.log(`[+] Auto-detected active IDE workspace profiles: ${this.envReport.ides.join(", ")}`);
    }

    // 4. Log integrations
    if (this.envReport.integrations && this.envReport.integrations.length > 0) {
      console.log(`[+] Loaded integrations: ${this.envReport.integrations.map((i) => i.name).join(", ")}`);
    }

    this.initialized = true;
  }

  /**
   * Main pipeline execution entry point
   */
  public async execute(userPrompt: string): Promise<HarnessOutput> {
    await this.autoConfigure();
    const startTime = Date.now();
    const maxLoops = this.config.maxToolLoops ?? 5;

    // 1. Guardrail Check (Input)
    const inputGuard = this.guardrails.verifyInput(userPrompt);
    if (!inputGuard.passed) {
      const execTime = Date.now() - startTime;
      return this.output.formatOutput(
        userPrompt,
        `Blocked by input guardrails: ${inputGuard.reason}`,
        execTime,
        "blocked"
      );
    }

    const sanitizedPrompt = inputGuard.sanitizedContent || userPrompt;

    // 2. Memory Context Gathering
    const latestTx = this.memory.readLatestTransaction();
    let memoryContext = "";
    if (latestTx) {
      memoryContext = `Latest memory transaction ledger details:\n` +
        `- Completed Work: ${latestTx.transaction_details.completed_work}\n` +
        `- Next/To-Do: ${latestTx.transaction_details.todo_list}\n` +
        `- Insights: ${latestTx.transaction_details.knowledge_improvements}`;
    }

    const sessionHistory = this.memory.getSessionHistory();

    // 3. Prompt Construction
    const messages = this.prompt.buildPromptMessages(
      sanitizedPrompt,
      sessionHistory,
      memoryContext || undefined
    );

    let toolLoops = 0;
    let finalContent = "";
    let lastResponse: ModelResponse | null = null;
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // 4. Main Model & Tool Loop
    try {
      while (toolLoops < maxLoops) {
        const schemas = this.tools.getToolSchemas();
        const response = await this.model.generateCompletion(messages, schemas);
        lastResponse = response;

        if (response.usage) {
          totalUsage.promptTokens += response.usage.promptTokens;
          totalUsage.completionTokens += response.usage.completionTokens;
          totalUsage.totalTokens += response.usage.totalTokens;
        }

        // Add model's assistant message to conversation history
        messages.push({
          role: "assistant",
          content: response.content || "",
        });

        // Check if tool calls exist
        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log(`[🤖 Model requested ${response.toolCalls.length} tool calls]`);

          for (const tc of response.toolCalls) {
            const toolName = tc.function.name;
            let toolArgs: any = {};
            try {
              toolArgs = JSON.parse(tc.function.arguments);
            } catch {
              // Argument parsing fallback
            }

            console.log(`🔨 Running Tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`);
            const toolResult = await this.tools.executeTool(toolName, toolArgs);
            console.log(`✅ Tool ${toolName} finished execution.`);

            // Append tool result message
            messages.push({
              role: "user",
              content: `Tool Execution Result (${toolName}): ${JSON.stringify(toolResult)}`,
            });
          }

          toolLoops++;
        } else {
          // No more tool calls, exit loop
          finalContent = response.content || "";
          break;
        }
      }

      if (toolLoops >= maxLoops) {
        console.warn(`[⚠️ Warning] Exceeded maximum tool execution loops (${maxLoops}).`);
      }

    } catch (err: any) {
      const execTime = Date.now() - startTime;
      return this.output.formatOutput(
        userPrompt,
        `Pipeline execution error: ${err.message || err}`,
        execTime,
        "failure"
      );
    }

    // 5. Evaluation & Self-Correction Check
    let evalScore = 100;
    let evalFeedback = "Passed programmatic validation.";
    const progEval = this.evaluation.programcheck(sanitizedPrompt, finalContent);
    evalScore = progEval.score;
    evalFeedback = progEval.feedback || evalFeedback;

    if (progEval.isSuccessful && this.config.runSelfEvaluation) {
      console.log("[🔎 Running LLM Self-Evaluation critique...]");
      const llmEval = await this.evaluation.selfEvaluate(
        sanitizedPrompt,
        finalContent,
        this.model
      );
      evalScore = llmEval.score;
      evalFeedback = llmEval.feedback || evalFeedback;

      if (!llmEval.isSuccessful) {
        console.warn(`[⚠️ Self-correction critique failed: ${evalFeedback}]`);
      }
    }

    // 6. Guardrail Check (Output)
    const outputGuard = this.guardrails.verifyOutput(finalContent);
    let outputContent = finalContent;
    if (!outputGuard.passed) {
      outputContent = `Blocked by output guardrails: ${outputGuard.reason}`;
    } else if (outputGuard.sanitizedContent) {
      outputContent = outputGuard.sanitizedContent;
    }

    // Update conversation session history
    sessionHistory.push({ role: "user", content: sanitizedPrompt });
    sessionHistory.push({ role: "assistant", content: outputContent });
    this.memory.saveSessionHistory(sessionHistory);

    // 7. Output formatting
    const execTime = Date.now() - startTime;
    return this.output.formatOutput(
      userPrompt,
      outputContent,
      execTime,
      outputGuard.passed ? "success" : "blocked",
      { score: evalScore, feedback: evalFeedback },
      totalUsage
    );
  }

  /**
   * Register an MCP server
   */
  public async addMcpServer(name: string, command: string, args: string[] = []): Promise<void> {
    await this.tools.registerMcpServer(name, command, args);
  }

  /**
   * Cleanup resource handles (e.g. MCP subprocesses)
   */
  public shutdown() {
    this.tools.shutdown();
  }
}
