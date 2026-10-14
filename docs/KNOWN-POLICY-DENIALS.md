# Known policy denials in incomplete inventories

Delivery governance now passes independently extracted connector IDs from incomplete package resources to standard classification evaluation. Incompleteness prevents a clear result, but it does not remove known connector evidence from denial checks. A confirmed explicit connector block or Business/Non-Business mixture remains blocked; a partial resource with no confirmed denial remains unavailable.

An invalid scope or ambiguous connector mapping invalidates that individual policy. It no longer erases an independent valid denial from another policy, whichever order the records arrived in. Whole-observation identity, freshness, resource identity and work limits still fail closed before evaluation; unsupported policy features cannot authorize execution.

Confirmed standard denial reasons are retained ahead of unknown diagnostics within the existing bounded result. Delivery reasons likewise preserve standard denials ahead of advanced-policy uncertainty and package gaps. The evaluator continues to report `complianceVerified: false`: classification findings do not establish effective enforcement, nonblockable exceptions, advanced rules, endpoint restrictions, full resource/schema coverage or current tenant compliance.

Validation on 14 October 2026:

- Focused standard-policy and delivery-governance checks: 60 passed.
- Checksum-verified package fixtures exercised a known blocked connector in a schema-incomplete flow at all six lifecycle phases. A no-denial counterpart stayed unavailable.
- Additional tests covered independent denials before/after invalid policy scope/group/classification and bounded diagnostics with confirmed denial reasons preserved.
- Production build passed.
- Full suite: 1,933 passed, one TODO. Backend branches 70.40% (7,122/10,116); unchanged 90.01% gate fails.

Policy/provider observations in these tests are synthetic. No tenant DLP policy, role, connection, import, agent task or Copilot Studio operation was changed. The full production objective remains open.
