import { Harness } from "./Harness.js";
import { ModelConfig } from "./model/ModelProvider.js";
import process from "node:process";

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        options[key] = val;
        i++;
      } else {
        options[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }

  return { options, positional };
}

async function main() {
  const { options, positional } = parseArgs();

  // Running standard AI Harness prompt pipeline
  const prompt = options.prompt || positional.join(" ");

  if (!prompt || prompt.trim() === "help") {
    console.log("AI Harness CLI Interface");
    console.log("========================");
    console.log("Usage for prompts:");
    console.log("  ./harness.sh --prompt \"What is the structure of this project?\"");
    console.log("  harness.bat --prompt \"What is the structure of this project?\"");
    console.log("\nOptions:");
    console.log("  --prompt       The request/prompt text for the AI");
    console.log("  --provider     openai | gemini | ollama (optional, auto-detected by default)");
    console.log("  --modelName    LLM Model Identifier (optional)");
    console.log("  --apiKey       API Credentials (optional)");
    console.log("  --baseUrl      Override standard API endpoint (optional)");
    console.log("  --selfEval     Run LLM Critique Self-Evaluation (true/false)");
    return;
  }

  const hasExplicitProvider = !!(options.provider || process.env.HARNESS_PROVIDER);
  const runSelfEval = options.selfEval === "true";
  let harness: Harness;

  if (hasExplicitProvider) {
    const provider = (options.provider || process.env.HARNESS_PROVIDER) as any;
    const modelName = options.modelName || process.env.HARNESS_MODEL || (provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini");
    const apiKey = options.apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    const baseUrl = options.baseUrl;

    const config: ModelConfig = {
      provider,
      modelName,
      apiKey,
      baseUrl,
    };

    harness = new Harness({
      model: config,
      runSelfEvaluation: runSelfEval,
    });
  } else {
    // Zero-config: Harness will automatically run scan and select best candidate
    harness = new Harness({
      runSelfEvaluation: runSelfEval,
    });
  }

  console.log("🚀 AI Harness starting pipeline execution...");

  const output = await harness.execute(prompt);
  harness.output.printConsoleSummary(output);

  harness.shutdown();
}

main().catch((err) => {
  console.error("[-] Unexpected Fatal Error in Harness CLI:", err);
  process.exit(1);
});
