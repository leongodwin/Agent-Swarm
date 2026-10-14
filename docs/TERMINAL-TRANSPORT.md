# Terminal transport resilience

Terminal viewers are independent of the coding agent process. A disconnected,
slow or failed viewer must not interrupt agent output or retain an unbounded
initial synchronization queue.

- Pending initial frames are bounded at 4 MiB of UTF-8 JSON. Overflow discards
  those frames and recovers from the parsed terminal snapshot.
- A socket whose outbound backlog exceeds 4 MiB stops receiving live frames. It
  receives a fresh snapshot after its backlog falls below 1 MiB. Only one parser
  synchronization per viewer may be pending at a time.
- Snapshot callbacks check viewer ownership before using the terminal. Closing a
  viewer or disposing the terminal invalidates pending callbacks.
- Synchronous send failures, asynchronous send errors and socket error events
  detach only the affected viewer. Close failures do not escape disposal.
- Both office WebSocket listeners limit inbound message reassembly to 1 MiB.
  Terminal pasted input remains capped at 64 KiB characters after JSON parsing.
  The inbound frame limit is not a limit on outbound state or terminal snapshots.

Local native WebSocket tests exercise live output, keystrokes, resizing, viewer
disconnect/reconnect and rejection of an oversized frame with close code 1009.
Additional tests cover UTF-8 initial-queue overflow, slow-viewer resynchronization,
send and close failures, synchronization ordering and saved terminal restoration.
These tests do not establish remote browser performance or production reliability
percentiles. A viewer transport failure does not restart a coding agent.

## Integration status, 14 October 2026

The initial full regression suite recorded 1,382 passing tests, one failing
native cleanup-coordination test and one TODO.
The cleanup test uses three native writer processes and a 10ms flush delay.
Four additional diagnostic runs of the two native writer scenarios recorded two
failed runs. Failure evidence includes `CLEANUP_BUSY`, rather than proving this
is a harmless timing flake. A separate full-suite failure had an I/O category
without its system code; the reader now retains a safe system-code diagnostic.

After the [cleanup coordination fixes](CLEANUP-COORDINATION.md), the full suite
passed 1,389 tests with one TODO. Four consecutive native writer-test runs passed
all eight scenarios. The build passed. Global backend branch coverage measured
65.74%, so the 90.01% coverage gate still fails. No 99.5% CI reliability claim is
supported. Live operation retains maintenance drain and the Copilot Studio pause;
local tests do not certify tenant deployment or production readiness.
