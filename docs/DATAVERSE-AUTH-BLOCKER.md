# Dataverse CLI sign-in blocked by Conditional Access

## Current status

Resolved for Dataverse CLI on 10 October 2026 using Windows interactive authentication without device-code mode. `dataverse auth who` and `dataverse org who` independently confirmed `leon@graspai.co.uk`, the expected tenant, and MyDevNet organization/user IDs. No Conditional Access policy was changed.

The user identified the failed policy as **Microsoft-managed: Block device code flow**; the Microsoft-managed per-user MFA policy succeeded.

`dataverse mcp allow 0c412cc3-0dd6-449b-987f-05b053db9457` found the client disabled and successfully enabled it for MyDevNet. Global Codex MCP registration `dataverse-org0efd6060` was added using the official stdio proxy and plugin operation context. Codex must restart to load the server. Actual MCP metadata/data reads remain unverified until then; CLI identity checks do not substitute for this verification.

After Codex restarted, the native Dataverse MCP tools successfully searched for Expense tables, described both table schemas, and executed record-count queries. Both counts were zero in MyDevNet. This establishes real read access in the restarted session. The office readiness configuration now includes `search`, `describe` and `read_query`; all 16 live checks passed at 2026-10-10 00:35:27 UTC. The periodic MCP readiness probe checks tool availability; the explicit metadata/data reads are separate evidence.

The original incident details below are retained for traceability.

## Event for the tenant administrator

- Account: `leon@graspai.co.uk`
- Tenant: `5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c`
- Application: Dataverse CLI
- Application ID: `0c412cc3-0dd6-449b-987f-05b053db9457`
- Error: `53003` (`BlockedByConditionalAccess`)
- UTC timestamp: `2026-10-10T00:20:52.845Z`
- Request ID: `62177a3b-353e-4467-a232-bad364382900`
- Correlation ID: `e1c5e91f-dfae-4afb-98b7-9040f32d6805`
- The error page reported the Windows device as compliant.
- Initiated authentication flow: device code.
- Intended resource: Dataverse development environment `https://org0efd6060.crm4.dynamics.com`.

## Required diagnosis

In Microsoft Entra admin center, open **Entra ID > Monitoring & health > Sign-in logs**. Find this event using the correlation ID, account and UTC time. Inspect **Conditional Access** for failed policies and **Troubleshooting and support** for the failed grant controls. Record the actual policy and required authentication method before retrying.

The error alone did not establish which policy failed. The user subsequently confirmed the device-code blocking policy from the Conditional Access tab. A compliant device does not establish that every policy requirement was satisfied.

Request an administrator-approved authentication method for this application. If the policy permits Windows broker authentication, the CLI supports an interactive attempt without `--deviceCode`:

```powershell
dataverse auth create --environment https://org0efd6060.crm4.dynamics.com --name swarm-development
```

Do not disable Conditional Access or substitute another application's token to evade the denied Dataverse CLI request. Existing PAC and SDK sessions are separate application authorizations; their success does not establish Dataverse MCP access.

After authentication is permitted, confirm the CLI profile's user and environment, register the Dataverse MCP server, and verify real metadata and data reads from a fresh worker session. Tool discovery alone is insufficient.

Reference: [Microsoft Conditional Access troubleshooting](https://learn.microsoft.com/en-us/entra/identity/conditional-access/troubleshoot-conditional-access).
