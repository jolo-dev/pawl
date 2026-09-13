# Build pawl's terminal client on OpenTUI over eve's HTTP API

eve's built-in terminal UI is not extensible: it exposes no public API, no command registration, and no theme or pane hooks, only display flags on `eve dev`. Rather than change agent harness a third time, pawl keeps eve as its runtime and builds its own single-pane client with OpenTUI, driving the agent through `eve/client` over the HTTP session API against a headless `eve dev --no-ui`. The requirement is one pane carrying conversation history and memory, which the client owns; the server keeps sessions, streaming, approvals, and memory.

## Considered Options

- **Keep eve's built-in TUI.** Rejected: it cannot carry pawl's brand, and it is not extensible.
- **Agent Client Protocol (`eve acp`).** Rejected: the initial adapter does not support session loading, listing, or resumption, durable ACP ids across restarts, model or mode configuration, or image and file prompts — and pawl needs session resume and model configuration.
- **Flue 2.x.** Rejected: it has no terminal UI at all. `flue run` is one-shot and interactive surfaces are messaging channels.
- **pi-coding-agent.** Rejected: it has the extensible TUI pawl wanted, but adopting it means abandoning the durable runtime, and the pane requirement does not need per-command extensibility.

## Consequences

- eve's own TUI becomes a development-only surface; the shipped experience is pawl's client.
- The AWS profile, SSO, region, and model pre-flight moves into the client. Only the prompt layer moves; the logic in `src/aws-credentials.ts` and `src/bedrock-models.ts` stays where its unit tests are.
- The client must render approval requests, because deploying is approval-gated. An approval the client cannot render is a deploy the user cannot run.
- Brand tokens already exist in `docs/DESIGN.md` and are reused rather than re-derived.
