# MyDevNet cloud-flow and Copilot validation — 10 October 2026

Cloud-flow runtime validation passed. The expense Copilot was imported, published and installed in Leon's Teams account. Published conversation validation is blocked by the agent's reported usage limit; the Copilot delivery gate remains incomplete.

## Target and scope

- Environment: `https://org0efd6060.crm4.dynamics.com` (MyDevNet).
- Tenant: `5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c`.
- Caller and synthetic notification recipient: `leon@graspai.co.uk`.
- Named solution: `CorporateExpenseManagement`, version `1.0.0.0`, ID `ff2ac821-e515-4c6b-a775-eeee5c5c7fc1`.
- PAC, Dataverse and FlowAgent live identities matched the approved target. Interactive authentication worked without changing Conditional Access.

This was functional development validation using one administrator account. It does not establish least-privilege employee/approver isolation. The harness exercised the real adapters, but did not execute a full independently reviewed release through the orchestrator, its leases and all release gates.

## Cloud flow: passed

The existing **Expense notification worker — MyDevNet validation** remained Started. Its Dataverse workflow ID is `cdd4902c-b1c4-f111-aaaf-7ced8d76eca6`; its runtime inventory ID is `f83199e2-5a84-1814-720b-558f98addf9d`. FlowAgent resolves the workflow ID alias correctly. Exact named-solution membership was verified. Preflight reported ready, two connected connection references and no definition errors or warnings.

The worker filter remained:

```text
exp_state eq 'Pending' and exp_istest eq true and exp_recipient eq 'leon@graspai.co.uk'
```

A fresh synthetic GBP 1.25 report (`0cde930c-eac4-f111-aaad-70a8a53b5970`) had a synthetic receipt uploaded, was submitted through the server operation, then approved through the server operation. Observed statuses were Submitted and Approved. The exact report was temporarily permitted for single-account synthetic approval; all nine original plugin configurations were restored in a finally block. Normal production notifications were not enabled.

| Check | Observed evidence |
| --- | --- |
| Review-required notification | Successful run `08584099422840386655990276896CU31`; dispatch `afdcb2cf-e22c-49ed-92b6-811e44bad093`; outbox Sent |
| Approved notification | Successful run `08584099420969682802667047793CU18`; dispatch `54815a05-892a-4f63-9a4d-992f623ee674`; outbox Sent |
| Worker replay | Successful run `08584099418919251728023455634CU26`; completed report excluded; exactly two fixture notifications remained Sent with unchanged dispatch IDs |
| Mailbox check | Both received messages and their sent-folder copies retrieved; recipient Leon, correct report and MyDevNet app links, synthetic wording |

Received and sent-folder copies are two views of each notification, not evidence of duplicate sends. This replay establishes no redispatch for this fixture; it is not a general exactly-once delivery proof. Approval-command replay, a new Canvas receipt-download journey and broader role tests were not performed in this batch.

## Copilot: publication passed, conversations blocked

**GraspAI Expense Inquiries**, schema `exp_ExpenseInquiries`, bot ID `14dfddfe-d3bc-49b2-a94c-21c816321018`, was packaged with the existing approved `exp` publisher and imported into the named solution. Source synchronization and package validation passed.

The imported Copilot package is `.swarm-reliability/expense-validation/CopilotStudio/artifacts/CorporateExpenseManagement.zip`, SHA-256 `28ED5517E19BB6281B1521282999B63BAF7ADA0B0633F5EEDB3425C79B4B2B24`.

PAC 2.11.2 reported a non-recoverable response parsing error while returning exit code zero. Readback nevertheless confirmed that publication had committed: `publishedon` was `2026-10-10T20:36:17Z`, with active/provisioned state. Studio independently displayed **Published by Leon 10/10/2026, 9:36 PM**. The adapter reconciled that fresh postcondition without repeating publication.

The Microsoft Teams channel was added. Leon explicitly approved the displayed installation terms and permissions, and the agent was installed into his own account. The actual published Teams conversation received **Expense receipt policy** and answered:

> This agent is currently unavailable. It has reached its usage limit. Please try again later.

No additional test messages were sent after this capacity failure. No licence purchase, trial or capacity change was made.

The Studio test pane separately returned an unrelated-topic fallback for the same receipt-policy question. The enabled topic's designer appeared empty, and opening its code editor failed with `Expected "triggerId" to match "[^\\/]+?", but received ""`. Topic source, target Dataverse content and a PAC clone contained the expected YAML. The routing/designer cause is unresolved; Studio testing cannot substitute for published-channel acceptance.

The expense-status topic also references flow `7bc83a32-42e5-4679-afeb-b94a38aa5665`, which was absent from MyDevNet's workflow query and flow inventory. A securely caller-scoped status flow must be deployed and bound before its tool-action case can pass. Caller-supplied email text alone is not an authorization boundary.

| Required published case | Result |
| --- | --- |
| Grounding / receipt policy | Attempted; usage-limit response; blocked |
| Fallback | Not executed; capacity blocker |
| Tool action | Not executed; capacity blocker and missing status flow |
| Authorization | Not executed; capacity blocker; administrator account cannot prove least privilege |
| Safety | Not executed; capacity blocker |
| Multi-turn | Not executed; capacity blocker |

## Reliability fixes and checks

Three defects exposed by live validation were corrected:

1. PAC's non-recoverable-error text now counts as a command failure even with exit code zero. A committed publication can still be reconciled through a fresh target readback.
2. Cloud-flow mapping accepts the packaged workflow GUID when Dataverse has no workflow unique name, while retaining exact solution-membership checks.
3. Preflight uses a cloned definition with only the recognized server-injected connector authentication reference removed. HTTP/custom authentication is preserved; tenant definitions and credentials are unchanged.

The focused delivery, target-mapping and platform-lifecycle suite passed **44 tests across three files**. The final application build, including TypeScript checks, passed. The existing large bundle warning remains. Copilot source consistency and ZIP checks passed. These checks do not mark the six conversation cases complete.

## Evidence and next steps

Local retained evidence is under `C:/temp/cubefarm/.swarm-reliability/platform-validation/`: `adapter-verification.json`, `operation-journal.json`, `notification-fixture.json`, `flow-readback.json`, `mail-verification.json`, `copilot-verification.json`, the target PAC clone, and publication/consent/Teams response screenshots. These ignored local artifacts are ad-hoc validation evidence, not a formal passing QA release receipt.

1. Resolve the published agent's capacity/usage availability with the tenant owner; confirm availability before continuing conversations.
2. Deploy and bind the status flow using supported Power Automate/Dataverse skills and authenticated caller-scoped authorization. Recheck real connection references and the topic tool contract.
3. Diagnose receipt-policy routing and the topic designer failure using supported authoring tools; regenerate and check source after changes.
4. Run all six published-channel cases and retain actual replies/tool effects and independent browser evidence. Keep the single-administrator permission limitation explicit until separate suitable accounts are available.

## Follow-up: status flow and receipt routing repairs (10 October 2026)

The missing flow was created as **Expense Inquiries - Get Expense Report Status**,
runtime ID `d1c1efae-bc12-4cd6-af90-05462e86193f`, Dataverse workflow
`c6e13219-efc4-f111-aaad-70a8a53b5970`. It is Started, registered as
`modernflowtype=1`, linked to Expense Inquiries through `botcomponent_workflow`,
and its membership in the exact CorporateExpenseManagement solution was verified.
The Skills trigger uses the native `manual` name and the response is synchronous.

The input is the exact report title (`text`), not a claimed caller identity. Its
Dataverse connection reference has `source: Embedded` with
`impersonation.source: invoker`, matching the portal's **Provided by run-only
user** setting. Both queries restrict `exp_submittinguser` using FetchXML
`eq-userid`. Reference text is XML-escaped before matching. It returns six text
outputs and performs no writes or notifications. An unauthenticated management
invocation was rejected because it lacked `x-ms-user-id`; it was not counted as
a successful run or as proof of cross-user isolation.

Four authenticated query checks passed: Leon's exact synthetic report returned
Approved; a nonexistent title, an XML injection string and a title containing
apostrophe/ampersand/angle brackets returned no match. These are Dataverse query
checks, not agent-flow runtime acceptance.

The YAML generator previously wrapped long plain scalar strings. Live Studio
inspection showed this lost the trigger or truncated message content, despite
passing Microsoft's authoring schema. The generator now leaves single-line
strings intact and emits multiline strings as literal blocks. Its check also
compares generated serialization. Studio now renders the original status topic,
resolves its input and six output types and asks for the report title. The FAQ
and fallback interactions were restored; the temporary diagnostic status topic
is inactive and excluded from the generated source package.

**Expense Receipt Policy** now handles receipt and currency questions directly.
The agent instructions specify GBP and a receipt for every expense, with no
threshold. A Studio conversation returned that rule and the missing-receipt
contact guidance. This is a Studio result; published Teams acceptance remains
blocked.

The repaired status conversation reaches a **Connect to continue** card for
Leon's Dataverse credentials. Runtime lookup is awaiting approval of that
remembered connection. The card lists the connector's 34 capabilities, including
upload and deletion, although this particular flow only reads reports. No consent
was silently granted.

PPAC showed prepaid Copilot Credits **purchased 0, assigned 0, consumed 0**,
legacy session capacity zero, and no pay-as-you-go billing plans. Leon's assigned
licences did not include Microsoft 365 Copilot. The published usage failure is
consistent with this absence of capacity. The tenant owner must acquire and
assign suitable capacity before the published conversation suite can continue;
no purchase, trial or billing-plan change was made.

Follow-up evidence: `status-flow-deployment.json`, `status-query-verification.json`,
`expense-status-flow.json`, `copilot-capacity-zero.png`,
`status-user-connection-consent.png` and the repaired source workspace under
`.swarm-reliability/`. Source synchronization, authoring-schema validation and
PAC package verification passed. These do not close the six published cases.

Studio's agent status additionally reports: **This agent uses premium features.
You'll need an upgraded license to publish it.** Publish is disabled. The CLI
republication attempt did not establish a fresh publication and was stopped;
readback retained `publishedon=2026-10-10T20:36:17Z`. The repairs are saved as draft
content. The old published version must not be represented as containing them.
The status panel also lists a generic author-credentials risk warning and no
evaluation run. The flow's invoker setting and user-connection prompt are verified,
but that warning is retained as unresolved until authenticated runtime and fresh
publication checks can reconcile it; least-privilege isolation is unproved.

The final combined export is
`CorporateExpenseManagement-status-final.zip`, SHA-256
`0BA3A6C5D3F39CDD314FA3F0BB1AAD3032E514186F30EB79C6FE451C7138AF90`.
Inspection confirmed the status flow's `manual` trigger, invoker impersonation,
and one actual `.msapp` component. Export/package checks are separate from import
or published-runtime acceptance. `receipt-policy-studio-pass.png` retains the
correct full receipt reply; `copilot-publication-license-block.png` retains the
publication warning.
