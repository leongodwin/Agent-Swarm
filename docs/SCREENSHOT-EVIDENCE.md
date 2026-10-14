# Screenshot evidence capture

Browser evidence is captured as bounded bytes from a regular file inside its
approved root: the session browser-output folder for collection, or the worktree
for a tool-returned screenshot link. Absolute and relative escapes, final file
symlinks, and directory junctions that resolve outside the root are rejected.

The opened descriptor must match the discovered filesystem identity. Capture
reads at most the initial size plus one byte, capped at 10 MiB, and verifies size,
timestamps, path resolution and identity again. Growth or replacement is rejected.
The callback receives those captured bytes rather than reopening a discovered
path. Directory enumeration excludes non-files and oversized entries.

PNG signatures and JPEG start/end markers must match the extension. This does
not decode the image or prove visual quality, scenario relevance or QA approval.
An invalid or unavailable file is omitted; its presence is never success evidence.

Regression tests use owned temporary files, sparse oversized files, a concurrent
growth injection and a native directory junction/symlink. No tenant changes or
model-provider calls are required. Copilot Studio remains paused.
