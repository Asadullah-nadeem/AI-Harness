export interface GuardrailResult {
  passed: boolean;
  reason?: string;
  sanitizedContent?: string;
}

export class Guardrails {
  private forbiddenInputPatterns: RegExp[] = [
    /private_key/i,
    /aws_secret/i,
    /db_password/i,
  ];

  private forbiddenOutputPatterns: RegExp[] = [
    /password123/i,
    /fake_token_value/i,
  ];

  /**
   * Run guardrails check on the input prompt.
   */
  public verifyInput(prompt: string): GuardrailResult {
    for (const pattern of this.forbiddenInputPatterns) {
      if (pattern.test(prompt)) {
        return {
          passed: false,
          reason: `Input violated guardrail rule matching pattern: ${pattern.toString()}`,
        };
      }
    }

    return { passed: true, sanitizedContent: prompt };
  }

  /**
   * Run guardrails check on the model's generated output content.
   */
  public verifyOutput(content: string): GuardrailResult {
    for (const pattern of this.forbiddenOutputPatterns) {
      if (pattern.test(content)) {
        return {
          passed: false,
          reason: `Output violated guardrail rule matching pattern: ${pattern.toString()}`,
        };
      }
    }

    // Ensure output does not contain local absolute filepaths if they look suspicious
    if (content.includes("C:\\xampp\\htdocs\\") || content.includes("/xampp/htdocs/")) {
      // Alert/sanitize local directory references if found
      const sanitized = content
        .replace(/C:\\xampp\\htdocs\\[a-zA-Z0-9-_]+/g, "[REDACTED_LOCAL_PATH]")
        .replace(/\/xampp\/htdocs\/[a-zA-Z0-9-_]+/g, "[REDACTED_LOCAL_PATH]");
      return { passed: true, sanitizedContent: sanitized };
    }

    return { passed: true, sanitizedContent: content };
  }

  /**
   * Programmatically register new input patterns.
   */
  public addInputRule(pattern: RegExp) {
    this.forbiddenInputPatterns.push(pattern);
  }

  /**
   * Programmatically register new output patterns.
   */
  public addOutputRule(pattern: RegExp) {
    this.forbiddenOutputPatterns.push(pattern);
  }
}
