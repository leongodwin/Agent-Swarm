param(
    [Parameter(Mandatory=$true)][Guid]$TenantId,
    [Parameter(Mandatory=$true)][string]$ExpectedUser
)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerApps.Administration.PowerShell -RequiredVersion 2.0.219 -DisableNameChecking -WarningAction SilentlyContinue
Add-PowerAppsAccount -TenantID $TenantId.ToString() -UseSystemBrowser $true | Out-Null
$caller = $global:currentSession.upn
if ([string]::IsNullOrWhiteSpace($caller)) { $caller = $global:currentSession.msalAccount.Username }
if (-not $global:currentSession.loggedIn -or $global:currentSession.tenantId -ne $TenantId.ToString() -or $caller -ne $ExpectedUser) {
    throw 'Authenticated identity differs from the requested tenant and account.'
}
# Keep the authenticated module in this process. Only refresh/close are accepted,
# never arbitrary commands. Native MSAL handles its secure in-memory token cache.
function Read-PolicyInventory {
    $endpoint = 'https://api.bap.microsoft.com/providers/PowerPlatform.Governance/v1/policies'
    $next = $endpoint + '?$top=50'
    $visited = @{}
    $policies = @()
    $pages = 0
    while ($next) {
        $uri = [Uri]$next
        if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'api.bap.microsoft.com' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Fragment -or $uri.AbsolutePath -ne '/providers/PowerPlatform.Governance/v1/policies') { throw 'Untrusted policy continuation destination.' }
        if ($visited.ContainsKey($next) -or ++$pages -gt 100) { throw 'Policy pagination is repeated or exceeds the inventory limit.' }
        $visited[$next] = $true
        $raw = InvokeApiNoParseContent -Route $next -Method GET -ThrowOnFailure
        if ($raw.StatusCode -ne 200 -or -not $raw.Content -or $raw.Content.Length -gt 4 * 1024 * 1024) { throw 'Policy HTTP response is unsuccessful, empty or oversized.' }
        $response = $raw.Content | ConvertFrom-Json
        if ($null -eq $response -or $null -eq $response.PSObject.Properties['value'] -or $response.Error -or $null -eq $response.value -or $response.value -isnot [System.Array]) { throw 'Incomplete policy inventory response.' }
        $policies += @($response.value)
        if ($policies.Count -gt 5000) { throw 'Policy inventory exceeds the limit.' }
        $next = $response.nextLink
        if ($response.'@odata.nextLink') { throw 'Unsupported policy continuation format.' }
    }
    return @{schemaVersion=1;tenantId=$global:currentSession.tenantId;caller=$caller;observedAt=[DateTime]::UtcNow.ToString('o');source='Get-DlpPolicy module route';moduleVersion='2.0.219';scope='standard-policy-inventory';complete=$true;pages=$pages;policies=@($policies)}
}
do {
    try {
        $result = @{status='observed';snapshot=(Read-PolicyInventory)}
    } catch {
        # Authentication tokens, request headers and raw server errors never leave the reader.
        $result = @{status='unavailable';reason='The authenticated policy request failed or returned an incomplete inventory.'}
    }
    [Console]::Out.WriteLine('SWARM_DLP ' + ($result | ConvertTo-Json -Depth 100 -Compress))
    $nextCommand = [Console]::In.ReadLine()
} while ($nextCommand -eq 'refresh')
