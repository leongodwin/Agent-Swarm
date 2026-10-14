# Governance input ownership

The lifecycle gate pins its execution scope before invoking a provider: phase,
source commit, environment, release, checkout, manifest, package hash, evidence
directory and resource-schema references. It retains the original cancellation
signal. The provider receives separate manifest/reference copies and its own
gate-controlled cancellation signal.
Input capture counts against the stage budget. A provider is not admitted if
capture has already exhausted that budget or its original request has changed.

Caller or provider changes invalidate the decision even if its returned hash
matches the altered manifest. Scope is checked after the provider settles and
at audit commit. A changed decision is written as unavailable in the original
phase's audit location with the original scope; it cannot authorize a replacement
target or overwrite another phase by changing the request object.

Tests mutate nested provider/caller manifests, schema columns, every scope field
and cancellation-signal identity, plus caller scope during rename. Provider
mutation cannot alter caller inputs. Existing deadline, audit-write failure and
native provider-close ownership tests remain required.

These tests prove in-process input ownership. They do not prove complete tenant
policy evaluation, comprehensive source/package/schema inventory, distributed
leases or zero production policy breaches. Copilot Studio remains paused.
