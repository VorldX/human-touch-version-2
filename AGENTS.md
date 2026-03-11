# Engineering priorities
1. Minimize token usage across all agent workflows
2. Prefer deterministic code over LLM calls
3. Keep prompts short and reusable
4. Never resend full chat history unless strictly necessary
5. Avoid duplicate model calls for parsing, formatting, and confirmation
6. Log per-call tokens and latency
7. Keep user-visible responses concise
8. Preserve product behavior unless a change clearly improves efficiency and stability
