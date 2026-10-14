# Complete target solution membership

The tenant mapper previously ignored continuation annotations. A partial unique
lookup could therefore appear unambiguous, and a valid target component on a later
membership page could appear absent. Unique solution/component lookups now reject
continuations; complete membership discovery follows bounded pages instead.

Continuations must retain the approved HTTPS environment origin, API collection,
selected fields and exact solution filter. Only a single nonempty `$skiptoken`
may be added. Credentials, fragments, duplicate query fields, alternate paths,
foreign hosts, unsupported continuation annotations and repeated cursors are
rejected before another request is dispatched. Provider links are converted to
validated relative API resources; the adapter never dispatches an arbitrary URL.

Membership is validated as GUID object identities and integer component types.
Duplicate identity/type pairs are rejected. Discovery is bounded to 100 pages,
5,000 rows per page, 50,000 total rows and 32 MiB of aggregate response JSON.
Exceeding a bound refuses the mapping; partial mappings are not published. Both
post-deployment and final verification pass the exact approved environment root.
Existing identity, lease and policy checks still govern the enclosing delivery.

Microsoft documents `@odata.nextLink` as the continuation marker:
[Dataverse page results](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/page-results).
The first focused adapter/delivery run passed 138 checks and type checking.
Full verification, including aggregate-limit and environment-root cases, passed
2,131 tests with one TODO. Backend branch coverage was 71.31% (7,486/10,497),
below the unchanged 90.01% gate. The production build passed.
These local provider-contract fixtures do not establish live
tenant import, complete schema/DLP governance, permission isolation or recovery.
Copilot Studio remains paused; Codex is default, with Gemini and OpenCode supported.
