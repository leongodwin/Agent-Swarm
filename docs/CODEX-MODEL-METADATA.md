# Explicit Codex model metadata preflight

Explicit model pins are checked through the installed Codex app-server model/list
API before generated hook trust changes and task launch. Two complete matching
inventories are required. Duplicate IDs/model names, missing continuation markers,
cursor loops, excessive pages, provider errors and changing metadata deny startup.
An unadvertised pin receives an actionable instruction to select a listed model
or clear the override. Default selection remains under native Codex control.

This is advertised metadata, not verified live access, capacity or subscription
entitlement. It does not infer model availability from task prose or silently
change the manager's model. Generic metadata failure is not an unsupported-model
hold; persistent worker model circuit breaking and other providers remain open.

The native model/list service on 2026-10-14 returned ten entries with a terminal
null cursor. The new preflight accepted gpt-6.1-sol and denied the deliberately
unadvertised swarm-invalid-model-validation-only pin in 786 ms, without requesting
inference. A separate isolated, tool-disabled native Codex exec probe confirmed
that the latter pin receives an invalid_request_error with HTTP status 400 under
the current ChatGPT-backed account. No successful model execution or tenant
mutation was established by that rejection probe.

Tests cover matching/reordered inventories, cursor pagination, malformed and
ambiguous responses, changed metadata, invalid inputs, limits and provider failure.
The full backend coverage threshold remains unchanged. Copilot Studio stays paused.
