# Delivery command output integrity

Delivery commands enforce one 8 MiB byte budget across stdout and stderr. The
previous character-based bound could admit substantially more multibyte output.
Once a command fails, further output is discarded and the first stop reason is
retained; later chunks cannot repeatedly spawn stop requests or grow the buffers.

Each stream uses an incremental fatal UTF-8 decoder. Characters split across
native pipe chunks remain intact. Invalid bytes or a truncated final character
make the command fail even when its process otherwise exits successfully. This
prevents replacement-character output from becoming parsed verification evidence.

Tests execute owned Node subprocesses through the actual command runner: Unicode
split writes, malformed stdout/stderr, a truncated tail, and combined multibyte
output exceeding the byte budget. No model or tenant operations run in fixtures.

Completion still waits for the native root's close. This batch does not establish
full descendant containment, independent QA, tenant acceptance or all-provider
reliability. Copilot Studio remains paused.
