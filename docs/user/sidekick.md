# Sidekick

Sidekick pairs two models in one thread. The lead plans, makes design decisions and reviews the result. The sidekick handles mechanical implementation, builds and tests through T3 Code's delegated-task system.

## Cross-provider and cross-family pairings

Lead and Sidekick do not need to come from the same brand or model family. Any enabled, orchestration-capable provider account in T3 Code can be paired: for example **Antigravity (`Gemini 4 Carbon`)** as Lead with **Cursor (`Grok 4.7`)**, **Codex (`GPT-6.1`)**, **Claude**, **Kimi Code**, or **OpenCode** as Sidekick, each with its own independent reasoning effort and speed settings.

## Start or adjust a pairing

1. Open **Sidekick** beside the lead model picker in the composer.
2. Choose the sidekick provider, model, reasoning effort, and speed (picking a model automatically enables Sidekick, or toggle **Enable Sidekick** directly).
3. **Change** next to the lead opens the lead model and effort picker.

Changes to the lead model, sidekick model, effort, or on/off state apply from the next message without interrupting a running turn. Turning Sidekick off preserves the pairing for the next time you enable it and notifies the lead on the next turn so it stops delegating to the previous sidekick target.

You still interact with one thread. Delegated work appears in the thread's activity, and the lead reviews it before finishing. Questions and other work with no implementation are answered directly without starting a sidekick. The sidekick does not inherit another sidekick of its own.
