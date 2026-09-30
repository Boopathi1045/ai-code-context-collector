# AI Code Context Collector

<p align="center">
  <img src="icon.png" width="128" height="128" alt="AI Code Context Collector Icon" />
</p>

<p align="center">
  <strong>Local-first code context extractor for web AI assistants (ChatGPT, Claude, Gemini, GitHub Copilot Web).</strong>
</p>

---

## 🚀 Overview

**AI Code Context Collector** is a production-quality VS Code extension that automatically analyzes large frontend and backend codebases to extract precise, character-accurate code context for a given task.

Instead of manually copy-pasting dozens of files or uploading entire massive repositories to web-based AI tools, you describe your task in plain English. The extension analyzes dependencies, identifies relevant files and symbols, extracts the **exact local source code**, and generates a clean, self-contained `ai-task-context.md` file ready to be uploaded or pasted into ChatGPT, Claude, Gemini, or GitHub Copilot Web.

---

## 🔒 Privacy & Local-First Architecture

* **100% Local**: Source code is analyzed locally on your machine.
* **No Cloud Uploads**: The extension **NEVER** uploads your source code to OpenAI, Anthropic, Google, GitHub, or any external servers.
* **No Telemetry**: Zero tracking, analytics, or telemetry.
* **No Project Modifications**: The extension only creates `ai-task-context.md` in your workspace root. It never modifies your existing `.ts`, `.js`, `.html`, or `.json` files.
* **Automated Secret Redaction**: Detects API keys, private keys, database connection strings, and tokens, automatically redacting them before packaging.

---

## 🏗️ Two-Stage Architecture

```text
                    User Task
                       │
                       ▼
             ┌────────────────────┐
             │ Local Static Scan  │
             │                    │
             │ Files & Imports    │
             │ AST Symbols        │
             │ Angular Decorators │
             │ Express Routes     │
             │ HTTP APIs & Models │
             └─────────┬──────────┘
                       │
                Candidate files
                       │
                       ▼
             ┌────────────────────┐
             │ Optional Ollama    │
             │ Local Small LLM    │
             │                    │
             │ Relevance ranking  │
             │ Code block select  │
             └─────────┬──────────┘
                       │
                Selected symbols
                       │
                       ▼
             ┌────────────────────┐
             │ Exact Source       │
             │ Extraction         │
             │                    │
             │ ORIGINAL CODE      │
             │ NO REWRITING       │
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ Markdown Generator │
             └─────────┬──────────┘
                       │
                       ▼
              ai-task-context.md
```

### Critical Guarantee: No AI Hallucinated Source Code
The local LLM is used **strictly for ranking candidate files and symbols**. The extension itself directly reads your local files from disk and copies the **exact, character-accurate source code** with surrounding class context, imports, and dependencies.

---

## 🦙 Ollama Integration (Strictly Optional)

Ollama is an **optional local enhancement**. The extension works out of the box with deterministic static analysis even if Ollama is not installed or running.

### Recommended Local Model
```bash
ollama pull qwen2.5-coder:1.5b
```

### Modes of Operation
1. **Mode A — Static Mode (Ollama Offline / Disabled)**:
   - Uses AST scanning, keyword matching, relationship graph distance, open file boost, and active selection boost.
2. **Mode B — AI-Assisted Mode (Ollama Running)**:
   - Sends candidate metadata (file paths, symbols, routes, API calls) to `qwen2.5-coder:1.5b` running on `http://localhost:11434`.
   - Parses structured JSON response and ranks top relevant symbols.
   - If Ollama fails, times out, or returns invalid schema, it gracefully falls back to Static Mode without interrupting your workflow.

---

## 💡 Supported Technologies

* **Frontend**: Angular (`@Component`, `@Injectable`, `@Directive`, `@NgModule`, `@Pipe`, `.html` templates, `.scss`/`.css` styles), TypeScript, JavaScript, HTML, SCSS, CSS.
* **HTTP APIs**: Angular `HttpClient`, `axios`, `fetch` with endpoint resolution.
* **Backend**: Node.js, Express.js (`router.get`, `app.post`, route-to-controller mapping, middleware).
* **Database & ORM**: MongoDB, Mongoose (`mongoose.model`, `Schema`), MySQL/SQL models.

---

## 🎮 Commands

| Command | Description |
| ------- | ----------- |
| `AI Code Context Collector: Create Task Context` | Main workflow: Prompts for task, scans workspace, displays interactive file review, extracts exact code, and opens `ai-task-context.md`. |
| `AI Code Context Collector: Show Related Files` | Shows interactive QuickPick of related files and relationships for the active file. |
| `AI Code Context Collector: Open Last Context` | Re-opens the generated `ai-task-context.md` in the editor. |
| `AI Code Context Collector: Add Selection to Context` | Pins the highlighted code block in the editor with maximum relevance priority. |

---

## ⚙️ Configuration Settings

Configure these options in your VS Code `settings.json`:

```json
{
  // Ollama Settings
  "aiCodeContextCollector.ollama.enabled": true,
  "aiCodeContextCollector.ollama.endpoint": "http://localhost:11434",
  "aiCodeContextCollector.ollama.model": "qwen2.5-coder:1.5b",
  "aiCodeContextCollector.ollama.timeoutMs": 30000,

  // Graph and Context Budgets
  "aiCodeContextCollector.maxRelationshipDepth": 3,
  "aiCodeContextCollector.maxCandidateFiles": 25,
  "aiCodeContextCollector.maxFiles": 30,
  "aiCodeContextCollector.maxContextSizeKB": 500,
  "aiCodeContextCollector.maxFileSizeKB": 500,

  // Formatting
  "aiCodeContextCollector.includeProjectStructure": true,

  // Exclude Patterns
  "aiCodeContextCollector.excludePatterns": [
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".angular",
    ".next",
    ".vscode",
    ".idea",
    "vendor",
    "target",
    "bin",
    "obj",
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml"
  ]
}
```

---

## 📖 Example Workflow

1. Open your full-stack repository (e.g., Angular frontend + Express backend).
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
   ```text
   AI Code Context Collector: Create Task Context
   ```
3. Enter your task:
   ```text
   Add subscription expiry notification to the customer management page.
   ```
4. Review the candidate files in the QuickPick dialog, toggle selections if desired, and press Enter.
5. The extension creates and opens `ai-task-context.md`.
6. Upload or paste `ai-task-context.md` into your web AI assistant (ChatGPT, Claude, Gemini, Copilot).

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
