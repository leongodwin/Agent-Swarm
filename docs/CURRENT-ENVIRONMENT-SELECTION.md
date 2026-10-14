# Current environment selection

The shared target selector accepts exactly one active HTTPS organization root
from a connected, real discovery snapshot. Stale, disconnected, absent, ambiguous
or unsafe snapshots return no target. It never substitutes the first listed row.
Demo display requires explicit opt-in and is rejected by tenant-write selectors.

Delivery configuration, tenant-policy refresh and Canvas authoring ownership use
the selector before calling providers. The engineering-tool Canvas lease path
uses the same rule. Feature scoping cannot reuse an active row from stale history.
New project target metadata, project-picker display, delivery display and chat
environment variables use the shared selector too. Delivery refreshes tenancy
alongside its five-second status refresh and shows discovery failure explicitly.

Saved approved deployment policy is still shown as the policy target; it is not
replaced from stale discovery. Pausing an existing policy remains available even
when no current profile exists. Pre-execution provider identity and governance
checks remain required; this selector does not prove token validity or tenant DLP.

Tests cover retained active rows with stale/absent status, no real identity,
multiple/no active rows, unsafe roots and explicit demo display. HTTP tests prove
delivery enablement, policy refresh and Canvas ownership reject invalid snapshots
without invoking provider writes. No tenant changes are needed for these tests.
Copilot Studio remains paused.
