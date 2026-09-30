# Change Log

All notable changes to the "AI Code Context Collector" extension will be documented in this file.

## [1.0.0] - 2026-09-28

### Initial Release
- **Two-Stage Architecture**: Fast local static scanning paired with optional local Ollama LLM relevance analysis.
- **Deep Static Analysis**:
  - TypeScript & JavaScript AST parsing for symbols, classes, methods, functions, and interfaces.
  - Angular `@Component`, `templateUrl`, `styleUrls`, `@Injectable`, and dependency injection resolution.
  - Express.js route & controller mapping (`router.get`, `app.post`, controller handler references).
  - HTTP API call detection (`HttpClient`, `axios`, `fetch`) and automated cross-layer route linking.
  - Database & Mongoose model detection (`mongoose.model`, schemas).
- **Exact Source Extraction**: Character-accurate extraction from disk with zero AI code modification or hallucination.
- **Context Expansion**: Enclosing class definitions, constructor dependencies, and file imports automatically preserved.
- **Security & Privacy First**:
  - Local-first execution with zero cloud telemetry or remote uploads.
  - Automated secret pattern detection and credential redaction.
  - Configurable exclusion patterns and size budgets.
- **Interactive Commands**:
  - `Create Task Context` (with interactive candidate review & file toggling)
  - `Show Related Files`
  - `Open Last Context`
  - `Add Selection to Context`
- **Markdown Generator**: Produces standard `ai-task-context.md` with project trees, relationship diagrams, symbol tables, and AI instructions.
