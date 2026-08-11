import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface TransactionPayload {
  timestamp: string;
  agent_id: string;
  transaction_details: {
    completed_work: string;
    todo_list: string;
    knowledge_improvements: string;
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class MemoryManager {
  private dataDir: string;
  private memoryDir: string;
  private sessionFile: string;
  private algorithm = "aes-256-cbc";
  private secretKey: string;
  private ivLength = 16;

  constructor(baseDir: string = ".") {
    this.dataDir = path.resolve(baseDir, "data");
    this.memoryDir = path.join(this.dataDir, "memory");
    this.sessionFile = path.join(this.dataDir, "session_history.json");

    // Use a clean, machine-independent key derivation or a standard fallback
    this.secretKey = crypto
      .createHash("sha256")
      .update(process.env.HARNESS_SECRET || "ai-harness-default-secret-v1")
      .digest("base64")
      .substring(0, 32);

    this.ensureDirectories();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  /**
   * Encrypts a JSON payload and writes it to a file named after its SHA-256 hash.
   */
  public writeTransaction(completedWork: string, todoList: string, insights: string): string {
    this.ensureDirectories();

    const payload: TransactionPayload = {
      timestamp: new Date().toISOString(),
      agent_id: process.env.USER || process.env.USERNAME || "AI_HARNESS",
      transaction_details: {
        completed_work: completedWork,
        todo_list: todoList,
        knowledge_improvements: insights,
      },
    };

    const payloadStr = JSON.stringify(payload);

    // Generate Transaction ID (SHA-256)
    const transactionId = crypto
      .createHash("sha256")
      .update(payloadStr + Date.now().toString())
      .digest("hex");
    const transactionFile = path.join(this.memoryDir, `${transactionId}.enc`);

    // Encrypt the payload
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      Buffer.from(this.secretKey),
      iv
    );

    let encrypted = cipher.update(payloadStr);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const fileData = iv.toString("hex") + ":" + encrypted.toString("hex");

    fs.writeFileSync(transactionFile, fileData, "utf8");
    return transactionId;
  }

  /**
   * Reads and decrypts the latest transaction file.
   */
  public readLatestTransaction(): TransactionPayload | null {
    if (!fs.existsSync(this.memoryDir)) return null;

    const files = fs
      .readdirSync(this.memoryDir)
      .filter((fn) => fn.endsWith(".enc"));
    
    if (files.length === 0) return null;

    // Find the most recently modified transaction file
    const latestFile = files
      .map((fn) => ({
        name: fn,
        time: fs.statSync(path.join(this.memoryDir, fn)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time)[0].name;

    return this.readTransactionFile(path.join(this.memoryDir, latestFile));
  }

  /**
   * Reads and decrypts a specific transaction file.
   */
  private readTransactionFile(filePath: string): TransactionPayload | null {
    try {
      const payload = fs.readFileSync(filePath, "utf8");
      const textParts = payload.split(":");
      const iv = Buffer.from(textParts.shift()!, "hex");
      const encryptedText = Buffer.from(textParts.join(":"), "hex");

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        Buffer.from(this.secretKey),
        iv
      );
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return JSON.parse(decrypted.toString());
    } catch (err) {
      console.error(`[-] Failed to decrypt or parse transaction file: ${filePath}`, err);
      return null;
    }
  }

  /**
   * Save session chat history
   */
  public saveSessionHistory(messages: ChatMessage[]): void {
    this.ensureDirectories();
    fs.writeFileSync(this.sessionFile, JSON.stringify(messages, null, 2), "utf8");
  }

  /**
   * Get session chat history
   */
  public getSessionHistory(): ChatMessage[] {
    if (!fs.existsSync(this.sessionFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.sessionFile, "utf8"));
    } catch {
      return [];
    }
  }

  /**
   * Clear session history
   */
  public clearSession(): void {
    if (fs.existsSync(this.sessionFile)) {
      fs.unlinkSync(this.sessionFile);
    }
  }
}
