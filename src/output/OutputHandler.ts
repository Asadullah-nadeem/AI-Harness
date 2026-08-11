export interface HarnessOutput {
  status: "success" | "failure" | "blocked";
  prompt: string;
  response: string;
  executionTimeMs: number;
  evalResult?: {
    score: number;
    feedback?: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class OutputHandler {
  /**
   * Format the final response and pipeline metrics into a standard payload
   */
  public formatOutput(
    prompt: string,
    response: string,
    executionTimeMs: number,
    status: "success" | "failure" | "blocked",
    evalResult?: { score: number; feedback?: string },
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  ): HarnessOutput {
    return {
      status,
      prompt,
      response,
      executionTimeMs,
      evalResult,
      usage,
    };
  }

  /**
   * Print a beautiful summary of execution to CLI console
   */
  public printConsoleSummary(output: HarnessOutput) {
    console.log("\n" + "=".repeat(60));
    console.log(`🧠 AI HARNESS PIPELINE EXECUTION SUMMARY`);
    console.log("=".repeat(60));
    console.log(`Status:      ${output.status.toUpperCase()}`);
    console.log(`Time:        ${output.executionTimeMs}ms`);
    if (output.evalResult) {
      console.log(`Eval Score:  ${output.evalResult.score}/100`);
      if (output.evalResult.feedback) {
        console.log(`Eval Feedback: ${output.evalResult.feedback}`);
      }
    }
    if (output.usage) {
      console.log(`Tokens:      Input: ${output.usage.promptTokens} | Output: ${output.usage.completionTokens} | Total: ${output.usage.totalTokens}`);
    }
    console.log("-".repeat(60));
    console.log("Final Response:");
    console.log("-".repeat(60));
    console.log(output.response);
    console.log("=".repeat(60) + "\n");
  }
}
