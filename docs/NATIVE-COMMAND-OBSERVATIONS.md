# Preserve native command encoding and failure observations

The shared command runner previously decoded native stdout/stderr with replacement
characters before metadata parsing, allowing malformed UTF-8 to appear as usable
text. It now requests raw buffers and requires fatal UTF-8 decoding on both streams.
Malformed or unverifiable output is refused without echoing its bytes. Valid Unicode,
empty output, whitespace trimming and BOM-compatible text behavior are preserved.

Command errors preserve numeric exit statuses, string native codes and absent
statuses separately. Their bounded diagnostic observation distinguishes exit,
spawn, termination, output-limit and encoding failures, and retains the native
reported signal/termination flag. Termination does not imply timeout causation,
descendant cleanup or successful work. The existing 32 MiB output and default
120-second command allowances remain unchanged.

All 85 focused native-command/GitHub checks passed. Owned synthetic native Node
fixtures cover literal argument/stdin boundaries, exact Unicode, malformed output
on either stream, numeric failure with and without stderr, a missing executable,
deadline termination and output overflow. Simulated GitHub metadata verifies
malformed bytes are refused before JSON parsing.

Full backend verification passed 2,280 tests with one TODO. The command module
reached 96.42% branch coverage; overall backend branches were 71.87%
(7,645/10,636), below the unchanged 90.01% gate. The production build passed.

After the guarded reload, live CI-history discovery through the real office
succeeded using the updated runner without a new sign-in. The selected GitHub
Actions creation window contained zero completed attempts; success percentage
and target status remained null. This confirms live read compatibility, not a
99.5% pass rate or coverage of external CI/tenant integration runs.

These observations do not certify process-family termination, broker recovery,
cross-process ownership or tenant deployment. The production-readiness objective
and its coverage gate remain unchanged. Copilot Studio stays paused; Codex is
default, with Gemini/OpenCode supported.
