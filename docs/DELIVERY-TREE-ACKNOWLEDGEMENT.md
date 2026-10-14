# Delivery process-tree acknowledgement

Cancelled or failed delivery commands wait for root close and the requested
tree-stop operation to settle. On Windows this includes the taskkill /T /F
callback. On POSIX the stop targets the command's private process group. A
failed tree stop is reported as unverified cleanup even when the root closes;
root-only fallback is not certified as successful tree termination.

A native signal error while the root has a PID does not settle the command ahead
of root exit acknowledgement. Output after failure remains discarded and cannot
dispatch additional tree-stop commands.

Controlled tests hold the Windows helper through root close, report helper
failure, and emit a root signal error while cleanup remains pending. Native Node
fixtures verify that cancelling the root stops heartbeat activity from an ordinary
child. No tenant mutation or model-provider execution is required.

This establishes acknowledgement ordering and ordinary descendant cancellation,
not containment of escaped daemons, PID-reuse protection, or durable recovery of
every native descendant across office restarts. Failed tree cleanup still requires
native process review; comprehensive runtime recovery remains incomplete.
Copilot Studio stays paused and the live office remains drained.
