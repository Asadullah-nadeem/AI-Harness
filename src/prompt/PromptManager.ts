import { ChatMessage } from "../memory/MemoryManager.js";

export class PromptManager {
  private systemInstruction: string;
  private variables: Map<string, string> = new Map();

  constructor(defaultSystemInstruction?: string) {
    this.systemInstruction =
      defaultSystemInstruction ||
      "You are a helpful, secure, and robust AI Agent operating under the AI Harness platform. " +
        "Always use available tools appropriately to solve the user request step-by-step. " +
        "Adhere to guardrails and local guidelines.";
  }

  public setSystemInstruction(instruction: string) {
    this.systemInstruction = instruction;
  }

  public setVariable(key: string, value: string) {
    this.variables.set(key, value);
  }

  public getVariable(key: string): string | undefined {
    return this.variables.get(key);
  }

  /**
   * Inject variables into a prompt template (e.g. {{variable_name}}).
   */
  public compileTemplate(template: string): string {
    let result = template;
    for (const [key, value] of this.variables.entries()) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      result = result.replace(placeholder, value);
    }
    return result;
  }

  /**
   * Builds the prompt payload containing system instruction and messages.
   */
  public buildPromptMessages(
    userPrompt: string,
    history: ChatMessage[] = [],
    additionalContext?: string
  ): ChatMessage[] {
    const compiledUserPrompt = this.compileTemplate(userPrompt);

    const messages: ChatMessage[] = [];

    // System instruction
    messages.push({
      role: "system",
      content: this.systemInstruction,
    });

    // Conversation history
    for (const msg of history) {
      if (msg.role !== "system") {
        messages.push(msg);
      }
    }

    // Additional context if present
    let finalUserPrompt = compiledUserPrompt;
    if (additionalContext) {
      finalUserPrompt = `Context:\n${additionalContext}\n\nUser Request: ${compiledUserPrompt}`;
    }

    // Current user prompt
    messages.push({
      role: "user",
      content: finalUserPrompt,
    });

    return messages;
  }
}
