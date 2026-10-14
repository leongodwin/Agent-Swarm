# Deployment settings governance

The approved delivery manifest must pair `settingsFile` with `settingsSha256`, the SHA-256 of its exact approved bytes. Existing manifests without settings remain valid. Settings users must update the manifest and obtain a reviewed release; the runner does not invent or approve a digest for them.

The runner reads a bounded UTF-8 JSON file (1 MiB maximum), rejects duplicate JSON keys including escaped aliases, and accepts only the documented PAC environment-variable and connection-reference fields. Logical names must be unique within each section, including case aliases. A connection reference must match exactly one approved component and its final connection-reference-check action, including connection ID and normalized connector ID. Configured values are not echoed in validation failures.

This shape is based on [Microsoft's deployment settings documentation](https://learn.microsoft.com/en-us/power-platform/alm/conn-ref-env-variables-build-tools). The local bounds, uniqueness and approval constraints are additional Agent Swarm requirements. Unsupported or extended settings shapes fail closed until explicitly implemented and reviewed.

Settings are validated before import, during import/post-deployment/verification/health governance, and at native import boundaries before dispatch and before accepting its result. The lifecycle request and audit support a settings digest. Clear provider evidence must report the same digest; caller or provider changes invalidate the captured scope. Content values are not copied into governance audits. A changed import input after an operation intent requires recovery reconciliation.

Validation on 14 October 2026:

- Full suite: 1,891 passed, one TODO. Backend branch coverage 70.14% (7,030/10,022); unchanged 90.01% gate fails.
- Two further caller/provider settings-scope mutation tests passed in the final focused run (49 tests total).
- Production build passed. Synthetic delivery tests exercised valid import/audit binding, wrong digest, change during governance and change during native import. Local file tests exercised unapproved bindings, ambiguous keys/names, invalid encoding, size limits and generic error reporting.

No tenant import, live connection ownership check, agent task or Copilot Studio action was performed. The checks establish byte/approval consistency, not effective tenant DLP, complete environment-variable/endpoint analysis, live usability or least-privilege access. As with package guards, boundary checks do not isolate PAC from concurrent filesystem writers after validation. The full production objective remains open.
