# Independent solution package inventory — 13 October 2026

Delivery governance can now inspect the actual solution ZIP instead of using only manifest declarations. The inspector reads root components, table/attribute metadata, cloud-flow references and operations, and nested Canvas datasource metadata. Package identity, supported component declarations and exact connector-reference declarations are compared before the stage can proceed. A standard-policy check evaluates the inspected connectors together inside each flow, so separate manifest references cannot hide a Business/Non-Business mixture.

This is read-only package inspection, not tenant deployment or full security certification. The production governance provider still returns unavailable unless a known classification or declaration violation requires blocking. Complete advanced policies, comprehensive source/target schemas, opaque code validation and Canvas runtime binding verification remain open.

## Integrity and processing boundaries

The inspector does not extract archives or execute their contents. It reads through a bounded file handle, checks for changes during reading, computes the package SHA-256, validates each file's expanded size and CRC, and hashes every visited entry. Root and nested archives share entry/expanded-byte limits. Compressed input is limited to 64 MiB, an entry to 32 MiB, aggregate expansion to 256 MiB, 10,000 entries and a compression ratio of 1,000. These are local inspection bounds, not Microsoft platform package-size claims. Cancellation interrupts entry reads. Unsupported or exceeded bounds produce incomplete evidence.

Traversal, reserved/invalid Windows names, case/normalized aliases, file/directory conflicts, links, special files, encrypted entries and unsupported compression are rejected. Microsoft Canvas archives contain legacy backslashes; the pinned ZIP reader normalizes those before traversal and alias validation. XML is validated with entity processing disabled; DOCTYPE/ENTITY declarations are rejected. Invalid JSON, missing referenced files, unresolved operation bindings and ambiguous identities cannot produce complete resource evidence.

Integrity and semantic completion are separate. Nonempty unsupported XML sections, opaque plugin code, roles, relationships, unknown operation/datasource types, extra files and missing root counterparts are reported. Canvas datasource discovery identifies native Dataverse table references but does not infer complete formula/control/library or effective runtime behavior. Even an entirely inspectable flow package is not a policy/schema authorization proof.

Dependencies are pinned: `yauzl` 3.4.0 and `fast-xml-parser` 5.11.2. Test ZIP generation uses `yazl` 3.3.1. CRC processing requires the Node runtime's `zlib.crc32`; missing support produces unavailable inspection. The current host is Node 24.19.0. Readers follow the [ZIP library's documented entry/size behavior](https://github.com/thejoshwolfe/yauzl) and actual exported package structure. The installed [Dataverse solution lifecycle skill](C:/Users/leon/.codex/plugins/cache/openai-curated-remote/dataverse/1.11.3/skills/dv-solution/SKILL.md) was used to establish the packaging workflow; no new export/import or tenant change was performed.

## Evidence and release behavior

Package stages compare the inspected digest with the independently bound package digest and the actual solution name/version with the approved manifest. Undeclared supported root components or connection references block the stage. Passing known-resource classification does not resolve unsupported resource or schema gaps.

`package-inventory-SHA256.json` is retained beside the stage decision and linked through `packageInventoryFile`. Delivery retains that file in its evidence index even when the stage is denied. Health evidence remains in its separate directory, preserving the signed release artifact list. The stored inventory contains hashes and selected metadata, not raw entry contents or credentials.

## Actual validation

The inspected historical combined Expense package has SHA-256 `66503f09845b774d60483c5cc57d0110c93e2726e208017427deb7143ac89c30`. It passed archive/required-metadata checks and yielded 29 files including nested Canvas entries, 18 root components, four table entries with 87 attributes, two connection references, one cloud flow with eight operations and one Canvas app. Its resource inventory remains incomplete: role/relationship/plugin/step semantics, Canvas formula/runtime behavior and additional metadata need validation. This local artifact inspection does not prove that the currently installed tenant version has the same bytes or behavior.

Tests cover real ZIP streams, nested packages, compression, CRC corruption, traversal, special-file headers, aliases, XML declarations, expansion limits, unsupported metadata/operations, policy mixtures inside actual flow resources, package drift, omitted declarations and retention of denied inventory evidence. Full suite: **506 passed**, one existing TODO. Full-backend branches: **2,198/6,290 (34.94%)**; the unchanged 90.01% coverage gate correctly returned exit code 1. The built isolated-office API regression and build/typechecking passed. Dependency audit reported zero known vulnerabilities at this checkpoint; that is not a general safety guarantee.

Evidence: `.swarm-reliability/expense-package-inventory-2026-10-13.json`, `package-inventory-coverage-2026-10-13.txt`, `package-inventory-coverage-exit-2026-10-13.txt`, `package-inventory-api-e2e-2026-10-13.txt` and `coverage/backend/coverage-summary.json`.

Next: expand schema/relationship/role and opaque-code adapters, discover/evaluate advanced policies, seal execution inputs and certify the restricted execution broker. Retain the full production, reliability, synthesis-latency and coverage targets. Copilot Studio remains paused.
