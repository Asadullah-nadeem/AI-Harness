# AI Harness

A standalone, executable, and highly reusable AI Harness repository built on a modular 7-step agentic pipeline. Easily integrated into any application, it provides robust prompting, tool calling, local transaction memory, LLM orchestration, safety guardrails, and validation critique out of the box.

```text
                         AI HARNESS
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
     PROMPT                 TOOLS                  MEMORY
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                           AI MODEL
                              │
                    ┌─────────┴─────────┐
                    │                   │
                EVALUATION          GUARDRAILS
                    │                   │
                    └─────────┬─────────┘
                              │
                           OUTPUT
                              │
                    Automatic Support
                              │
       ┌──────────────┬───────┼───────┬──────────────┐
       │              │       │       │              │
      AI            MCP     IDE     Tools       Integrations
```

---

## Features & Dynamic Detection

The Harness processes requests sequentially through these seven parts:

1. **Prompt**: Compiles templates, variables, and builds structured messages including system instructions.
2. **Tools**: Houses local function executors (such as files, directory listing) and spawns stdio JSON-RPC clients to connect dynamically to Model Context Protocol (MCP) servers.
3. **Memory**: Operates an AES-256 encrypted transaction ledger to persist task handoffs across sessions, alongside automatic conversation history caching. Saved entirely under local git-ignored `data/` directory.
4. **AI Model**: Native HTTP interface for calling Gemini, OpenAI, or local Ollama models with automatic tools Schema mapping.
5. **Evaluation**: Automates verification, supporting programmatic schema checks and AI Critique-based self-evaluation checks.
6. **Guardrails**: Regulates safety by scanning prompts and outputs to redact forbidden strings, secrets, and leakable workspace paths.
7. **Output**: Formats results, tracks token consumption metrics, and handles CLI representation.

---

## Installation & Setup

1. **Zero-Configuration Launcher**:
   The Harness will automatically bootstrap dependencies, compile TypeScript, scan your environment, and execute when you run the launcher.

   - **Windows**:
     ```cmd
     harness.bat --prompt "Your message"
     ```
   - **Linux/macOS**:
     ```bash
     chmod +x harness.sh
     ./harness.sh --prompt "Your message"
     ```

2. **Manual Installation & Build**:
   ```bash
   npm install
   npm run build
   ```

3. **Optional Environments**:
   No `.env` file is required. The Harness automatically runs an environment scan:
   - If `GEMINI_API_KEY` is in your environment, it enables Gemini.
   - If `OPENAI_API_KEY` is in your environment, it enables OpenAI.
   - If a local Ollama instance is running, it queries the available local models and uses them.
   - It scans standard global folders and workspace files for Model Context Protocol (MCP) servers and IDE rules, dynamically loading them.



## Repository Policy

All persistent and session data resides in `data/`, which is ignored in Git config via `.gitignore` to prevent any leaked keys, absolute local paths, or local metrics from hitting public repositories.
