# Refuse ambiguous empty-history recovery

The startup-recovery inspector formerly parsed raw lease/history bytes directly,
bypassing the shared duplicate-key check. Duplicate `runs`, `releases`, `blockers`
or `attempts` fields could hide retained cloud operations behind a final empty
array. Duplicate lease identities could also distort ownership inspection.

Recovery inspection now uses strict UTF-8 decoding and bounded unambiguous JSON
parsing for both files. Lease bytes remain limited to 16 KiB and history to
16 MiB. Existing regular-file checks, repeated SHA-pinned inspections and the
shared filesystem guard remain. Ambiguity produces invalid/unavailable evidence,
not an eligible empty history. Both the prior valid snapshot and a digest of the
ambiguous bytes are refused; no marker moves or archive creation occur.

Lease assertion and release already use the strict bounded reader. New successor
fixtures verify duplicate PID/token fields cannot authorize release of a marker,
including escaped duplicate spellings. Original bytes remain intact.

All 82 focused recovery, lease and production HTTP checks passed, along with type
checking. The authenticated HTTP fixture preserves workspace diagnostics while
reporting invalid recovery history, refuses recovery in maintenance mode and
preserves both files without starting an agent. These are local ownership and
recovery-gate checks, not remote operation reconciliation or tenant restoration.
The full test-environment recovery rehearsal remains a separate requirement.

Full backend verification passed 2,209 tests with one TODO. Branch coverage was
71.47% (7,544/10,555), below the unchanged 90.01% gate. The production build passed.

Copilot Studio stays paused. Codex remains default, with Gemini/OpenCode supported.
