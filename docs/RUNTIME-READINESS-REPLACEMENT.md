# Validate runtime readiness before retiring terminal work

Replacement previously retired the current CLI before asynchronous native model,
hook or protected-profile checks completed. Failed readiness checks now preserve
the original process, input watcher, bindings, session token and task ownership.
Only verified readiness followed by fresh task authorization and unchanged
terminal ownership may begin retirement. Native cleanup remains acknowledged
before a replacement is spawned.

An exclusive per-terminal admission reservation prevents two pending replacement
checks from competing. Cancellation releases only its own reservation; late
readiness success cannot start cancelled work. If the original terminal exits or
changes ownership during checking, admission fails rather than starting against
stale state. Retained follow-up adoption also waits for trust verification before
rebinding the idle terminal. Codex resume-readiness promise failures are handled
as failed admission rather than becoming unhandled rejections.

All 47 focused authority/native cleanup checks and type checking passed. Tests
cover Codex model rejection and trust failure, Gemini profile failure, cancellation,
revoked task authorization, competing admission, original-owner exit, successful
replacement and failed retained follow-up. They verify the original task can
still use its admitted hook after failed replacement. The native cleanup fixture
uses an owned synthetic process through the real keeper.

Full backend verification passed 2,147 tests with one TODO. Branch coverage was
71.40% (7,520/10,531), below the unchanged 90.01% gate. The production build passed.

This establishes replacement behavior at local admission boundaries. It does
not prove model inference availability, all startup/OS spawn failures, native
descendant/broker cleanup, cross-process admission or live tenant delivery.
Copilot Studio remains paused and Codex remains default, with Gemini/OpenCode
supported. The earlier synchronous policy protections remain in force.
