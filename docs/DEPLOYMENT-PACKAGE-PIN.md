# Deployment package pin

A delivery run's retained package digest now applies to import, post-deployment, verification and health governance. A new package cannot replace that pin merely because a later provider approves different bytes. Native import re-resolves the contained package path and checks the pin immediately before dispatch and again before accepting the command result. Office ownership is also checked again after asynchronous boundary validation.

Package hashing uses an opened descriptor, streaming bytes and comparing file identity, size and modification/change timestamps before opening, after reading and against the final pathname. Non-regular, empty and oversized files are rejected; the 64 MiB bound matches the default compressed-package inventory limit. Cancellation is retained and descriptors are closed on failure. This replaces the unbounded whole-file reads used for initial and resumed recovery pins.

If an import boundary cannot verify the package after an intent is recorded, the operation remains unknown and recovery is required. A command may already have changed the tenant when the post-command check fails: its success is not certified and automatic re-import is not justified. The checks observe file state at their boundaries; they do not provide operating-system isolation against a concurrent writer changing a pathname after validation and before PAC opens it. Deployment settings and complete resource/schema/DLP inventory remain separate requirements.

Validation on 14 October 2026:

- All 97 delivery integration tests passed, including changes during governance, native import and capability checks after the recovery pin.
- Seven corrected file tests passed, including real file replacement/growth with controlled timing and descriptor closure.
- Production build passed.
- Full suite: 1,871 passed, one TODO. Backend branches 69.98% (6,978/9,970); the unchanged 90.01% gate fails.
- The initial focused run had two test failures: Windows detected rename-driven metadata change earlier than the asserted error point, and Node invoked its idempotent close operation twice. Corrected tests assert rejection and actual descriptor closure. Failed logs remain retained.

Delivery command/provider callbacks in the integration tests are synthetic. No Microsoft tenant import, policy relaxation, agent task or Copilot Studio operation occurred. Comprehensive governance, tenant end-to-end acceptance, the 99.5% all-CI-and-integration target and greater-than-90% backend branch coverage remain open.
