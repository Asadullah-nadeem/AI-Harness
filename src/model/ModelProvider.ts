import { ChatMessage } from "../memory/MemoryManager.js";

export interface ModelConfig {
  provider: "openai" | "gemini" | "ollama";
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}

export interface ModelResponse {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class ModelProvider {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  public async generateCompletion(
    messages: ChatMessage[],
    tools?: any[]
  ): Promise<ModelResponse> {
    switch (this.config.provider) {
      case "openai":
        return this.callOpenAI(messages, tools);
      case "gemini":
        return this.callGemini(messages, tools);
      case "ollama":
        return this.callOllama(messages, tools);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  private async callOpenAI(messages: ChatMessage[], tools?: any[]): Promise<ModelResponse> {
    const url = this.config.baseUrl || "https://api.openai.com/v1/chat/completions";
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey && url.includes("api.openai.com")) {
      throw new Error("OpenAI API key is missing. Please set OPENAI_API_KEY env or config.");
    }

    const body: any = {
      model: this.config.modelName,
      messages: messages,
      temperature: this.config.temperature ?? 0.7,
    };

    if (tools && tools.length > 0) {
      // Map input_schema to parameters for standard OpenAI format
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const message = choice?.message;

    return {
      content: message?.content || null,
      toolCalls: message?.tool_calls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  private async callGemini(messages: ChatMessage[], tools?: any[]): Promise<ModelResponse> {
    const apiKey = this.config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Please set GEMINI_API_KEY env or config.");
    }

    // Gemini supports OpenAI compatibility endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/chat/completions`;

    const body: any = {
      model: this.config.modelName || "gemini-1.5-flash",
      messages: messages,
      temperature: this.config.temperature ?? 0.7,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const message = choice?.message;

    return {
      content: message?.content || null,
      toolCalls: message?.tool_calls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  private async callOllama(messages: ChatMessage[], tools?: any[]): Promise<ModelResponse> {
    const url = this.config.baseUrl || "http://localhost:11434/api/chat";

    const body: any = {
      model: this.config.modelName,
      messages: messages,
      options: {
        temperature: this.config.temperature ?? 0.7,
      },
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const message = data.message;

    return {
      content: message?.content || null,
      toolCalls: message?.tool_calls?.map((tc: any, index: number) => ({
        id: tc.id || `call_${index}_${Date.now()}`,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === "string" 
            ? tc.function.arguments 
            : JSON.stringify(tc.function.arguments),
        },
      })),
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }
}
