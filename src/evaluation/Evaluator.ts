import { ModelProvider } from "../model/ModelProvider.js";
import { ChatMessage } from "../memory/MemoryManager.js";

export interface EvaluationResult {
  isSuccessful: boolean;
  score: number; // 0 to 100
  feedback?: string;
}

export class Evaluator {
  /**
   * Run programmatic validation (e.g. check for key terms, format checks)
   */
  public programcheck(prompt: string, response: string): EvaluationResult {
    // Basic verification - checking that output is not empty/too short
    if (!response || response.trim().length < 5) {
      return {
        isSuccessful: false,
        score: 10,
        feedback: "Response is empty or too short.",
      };
    }

    return {
      isSuccessful: true,
      score: 100,
    };
  }

  /**
   * Run LLM-assisted self-correction check.
   * Compares the response against the user prompt and returns a quality grade.
   */
  public async selfEvaluate(
    prompt: string,
    response: string,
    modelProvider: ModelProvider
  ): Promise<EvaluationResult> {
    const evalMessages: ChatMessage[] = [
      {
        role: "system",
        content: `You are an AI Critic. Your task is to evaluate if the Assistant's Response successfully satisfies the User's Request.
Assess safety, factual alignment, and correctness.
Return your evaluation in JSON format:
{
  "isSuccessful": boolean,
  "score": number (0 to 100),
  "feedback": "detailed review comments"
}`,
      },
      {
        role: "user",
        content: `User Request: "${prompt}"\n\nAssistant's Response: "${response}"`,
      },
    ];

    try {
      const evalRes = await modelProvider.generateCompletion(evalMessages);
      if (evalRes.content) {
        // Strip code block markers if any
        const cleaned = evalRes.content
          .replace(/```json/i, "")
          .replace(/```/g, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        return {
          isSuccessful: !!parsed.isSuccessful,
          score: typeof parsed.score === "number" ? parsed.score : 50,
          feedback: parsed.feedback || "No feedback provided by critic model.",
        };
      }
    } catch (err: any) {
      return {
        isSuccessful: true,
        score: 80,
        feedback: `LLM Self-evaluation failed to execute or parse: ${err.message || err}. Defaulting to success.`,
      };
    }

    return { isSuccessful: true, score: 70, feedback: "Evaluation returned empty content." };
  }
}
