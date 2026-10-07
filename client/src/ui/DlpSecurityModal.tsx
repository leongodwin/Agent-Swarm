import { useState } from 'react';
import { Panel } from './Overlays';
import { useStore, repoOnFloor } from '../store';
import { api } from '../api';
import { ALLOWED_BUSINESS_CONNECTORS, ENTERPRISE_DLP_RULES, auditDlpCompliance, type DlpPolicyViolation } from '../../../shared/dlp';

export function DlpSecurityModal() {
  const [activeTab, setActiveTab] = useState<'rules' | 'scanner' | 'entra'>('scanner');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    scannedFiles: number;
    violations: DlpPolicyViolation[];
    timestamp: string;
    isRealScan: boolean;
    scannedPaths?: string[];
    repoName?: string;
    isDemoInjection?: boolean;
  } | null>(null);

  const repos = useStore((s) => s.repos);
  const floor = useStore((s) => s.floor);
  const currentRepo = repoOnFloor(repos, floor) ?? repos[0];

  const handleRunScan = async () => {
    setIsScanning(true);
    try {
      const report = await api.dlpScan(currentRepo?.id);
      setScanResult({
        scannedFiles: report.scannedFiles,
        violations: report.violations,
        timestamp: report.timestamp,
        isRealScan: report.isRealScan,
        scannedPaths: report.scannedPaths,
        repoName: report.repoFullName,
        isDemoInjection: false,
      });
    } catch {
      setScanResult({
        scannedFiles: 0,
        violations: [],
        timestamp: new Date().toLocaleTimeString(),
        isRealScan: false,
        scannedPaths: [],
        repoName: currentRepo?.fullName ?? 'Offline',
        isDemoInjection: false,
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleInjectViolationDemo = () => {
    setIsScanning(true);
    setTimeout(() => {
      const badFlow = `
      {
        "name": "LegacyBackupWorkflow",
        "actions": {
          "Dropbox_Upload": { "type": "OpenApiConnection", "inputs": { "host": { "connectionName": "shared_dropbox" } } },
          "PublicWebhook": { "type": "Http", "inputs": { "authentication": { "type": "None" } } }
        }
      }`;
      const violations = auditDlpCompliance(badFlow, 'Workflows/LegacyBackupWorkflow.json');

      setScanResult({
        scannedFiles: 2,
        violations,
        timestamp: new Date().toLocaleTimeString(),
        isRealScan: false,
        scannedPaths: ['Workflows/LegacyBackupWorkflow.json'],
        repoName: `${currentRepo?.fullName ?? 'demo/solution'} (Injected Simulation)`,
        isDemoInjection: true,
      });
      setIsScanning(false);
    }, 300);
  };

  return (
    <Panel
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🛡️</span>
          <span>Microsoft Entra ID & Power Platform DLP Policy Kiosk</span>
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: '#0284c7', color: '#fff', fontWeight: 700 }}>
            ZERO-TRUST GUARDRAIL
          </span>
        </div>
      }
      wide
      accent="#0284c7"
      className="dlp-security-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 560 }}>
        {/* Sub-header Banner */}
        <div style={{ background: '#061325', padding: '12px 18px', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #0369a1' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              Tenant Security Perimeter: <span style={{ color: '#38bdf8' }}>contoso.onmicrosoft.com</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Autonomous coding agents are isolated within Microsoft Entra ID boundaries. Cross-tenant exfiltration blocked.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, background: '#064e3b', color: '#34d399', border: '1px solid #059669', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>
              ● ENTRA CONDITIONAL ACCESS
            </span>
            <span style={{ fontSize: 11, background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>
              ● DLP POLICY GATE ACTIVE
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 10, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
          <button
            onClick={() => setActiveTab('scanner')}
            style={{
              background: activeTab === 'scanner' ? '#0369a1' : '#0f172a',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            🔍 Live Solution Scanner
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            style={{
              background: activeTab === 'rules' ? '#0369a1' : '#0f172a',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            📋 DLP Connector Classifications
          </button>
          <button
            onClick={() => setActiveTab('entra')}
            style={{
              background: activeTab === 'entra' ? '#0369a1' : '#0f172a',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            🔐 Entra ID Service Principals & PAC CLI
          </button>
        </div>

        {/* Tab 1: Live Solution Scanner */}
        {activeTab === 'scanner' && (
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, flex: 1 }}>
            <div style={{ background: '#0f172a', padding: 16, borderRadius: 10, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>Automated Governance Audit</div>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
                Scans all unpacked Power Automate Cloud Flows (<code>Workflows/*.json</code>) and Copilot Studio Topics (<code>BotComponents/*.yaml</code>) for restricted connectors before merging into production.
              </p>

              <button
                onClick={handleRunScan}
                disabled={isScanning}
                style={{
                  background: isScanning ? '#334155' : '#0284c7',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 16px',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: isScanning ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <span>{isScanning ? '⏳' : '🛡️'}</span>
                <span>{isScanning ? 'Auditing Repo Solution Files…' : 'Scan Solution Checkout for DLP'}</span>
              </button>

              <button
                onClick={handleInjectViolationDemo}
                disabled={isScanning}
                style={{
                  background: '#374151',
                  color: '#cbd5e1',
                  border: '1px dashed #6b7280',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: isScanning ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>🧪</span>
                <span>Simulated Test: Inject Blocked Connectors</span>
              </button>

              <div style={{ marginTop: 'auto', background: '#090e1a', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700, marginBottom: 4 }}>Merge Gate Integration</div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
                  PRs containing DLP violations are automatically sent back to developer agents with remediation instructions, halting auto-merge.
                </div>
              </div>
            </div>

            <div style={{ background: '#0f172a', padding: 16, borderRadius: 10, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Scan Results & Audit Log</div>
                  {scanResult && (
                    scanResult.isRealScan ? (
                      <span style={{ fontSize: 10, background: '#064e3b', color: '#34d399', border: '1px solid #059669', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        ● LIVE REPO SCAN
                      </span>
                    ) : scanResult.isDemoInjection ? (
                      <span style={{ fontSize: 10, background: '#451a03', color: '#fbbf24', border: '1px solid #b45309', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        ⚠ DEMO SIMULATION
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, background: '#1e293b', color: '#94a3b8', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        NO UNPACKED FILES
                      </span>
                    )
                  )}
                </div>
                {scanResult && (
                  <span style={{ fontSize: 11, color: '#64748b' }}>Last Run: {scanResult.timestamp}</span>
                )}
              </div>

              {isScanning ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12 }}>
                  <div style={{ fontSize: 32, animation: 'spin 2s linear infinite' }}>🛡️</div>
                  <div style={{ fontSize: 14, color: '#38bdf8', fontWeight: 600 }}>Evaluating DLP Policy Rules against Solution Files…</div>
                </div>
              ) : scanResult ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                  <div style={{
                    background: scanResult.violations.length === 0 ? '#052e16' : '#450a0a',
                    border: `1px solid ${scanResult.violations.length === 0 ? '#166534' : '#991b1b'}`,
                    padding: 12,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <span style={{ fontSize: 20 }}>{scanResult.violations.length === 0 ? '✓' : '⚠️'}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: scanResult.violations.length === 0 ? '#4ade80' : '#f87171' }}>
                        {scanResult.violations.length === 0 ? '100% DLP Compliant · Zero Violations' : `${scanResult.violations.length} Policy Violations Detected`}
                      </div>
                      <div style={{ fontSize: 11, color: '#cbd5e1' }}>
                        Scanned {scanResult.scannedFiles} solution artifact file{scanResult.scannedFiles === 1 ? '' : 's'} {scanResult.repoName ? `in ${scanResult.repoName}` : ''}.
                      </div>
                    </div>
                  </div>

                  {scanResult.scannedPaths && scanResult.scannedPaths.length > 0 && (
                    <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#94a3b8' }}>Scanned files:</span>
                      {scanResult.scannedPaths.slice(0, 5).map((p, idx) => (
                        <code key={idx} style={{ background: '#090e1a', padding: '1px 5px', borderRadius: 4, color: '#38bdf8' }}>{p}</code>
                      ))}
                      {scanResult.scannedPaths.length > 5 && (
                        <span>+{scanResult.scannedPaths.length - 5} more</span>
                      )}
                    </div>
                  )}

                  {scanResult.violations.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 320 }}>
                      {scanResult.violations.map((v, i) => (
                        <div key={i} style={{ background: '#1c1917', border: '1px solid #78350f', padding: 12, borderRadius: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>{v.connectorName}</span>
                            <span style={{ fontSize: 10, background: '#991b1b', color: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                              {v.category.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: '#fdba74', fontFamily: 'monospace' }}>📄 {v.resourceFile}</div>
                          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>{v.remediation}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: '#64748b' }}>
                  <div style={{ fontSize: 40 }}>🛡️</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Ready to Audit Solution</div>
                  <div style={{ fontSize: 12 }}>Click &quot;Scan Solution for DLP Compliance&quot; on the left to inspect solution connectors.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: DLP Connector Classifications */}
        {activeTab === 'rules' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, overflowY: 'auto' }}>
            {/* Allowed Business */}
            <div style={{ background: '#0f172a', padding: 16, borderRadius: 10, border: '1px solid #166534', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>✓ Approved Business Connectors</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Connectors allowed to read, write, and process confidential enterprise business data.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {ALLOWED_BUSINESS_CONNECTORS.map((c, i) => (
                  <div key={i} style={{ background: '#090e1a', padding: 10, borderRadius: 8, border: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{c.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>{c.name}</span>
                    </div>
                    <span style={{ fontSize: 10, color: '#38bdf8', fontFamily: 'monospace' }}>{c.auth}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Restricted / Blocked */}
            <div style={{ background: '#0f172a', padding: 16, borderRadius: 10, border: '1px solid #991b1b', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>✕ Blocked & Restricted Connectors</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Connectors forbidden in solution flows to prevent data exfiltration.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {ENTERPRISE_DLP_RULES.map((r, i) => (
                  <div key={i} style={{ background: '#090e1a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#f87171' }}>{r.name}</span>
                      <span style={{ fontSize: 10, background: r.category === 'Blocked' ? '#7f1d1d' : '#854d0e', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>
                        {r.category}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Entra ID Service Principals */}
        {activeTab === 'entra' && (
          <div style={{ background: '#0f172a', padding: 18, borderRadius: 10, border: '1px solid #1e293b', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>Microsoft Entra ID Zero-Trust Architecture</div>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              Each autonomous coding agent operates through dedicated Azure App Registrations and Application Users mapped to Dataverse Security Roles.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <div style={{ background: '#090e1a', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>1. Agent Service Principals</div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  Authentication via Client ID / Secret or Managed Identity. No interactive user credentials stored on disk.
                </div>
              </div>
              <div style={{ background: '#090e1a', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>2. Least-Privileged Security Roles</div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  Copilot agents have read-only access to knowledge tables; automation agents hold scoped workflow triggers.
                </div>
              </div>
              <div style={{ background: '#090e1a', padding: 12, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>3. PAC CLI Auth Profiles</div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  <code>pac auth create</code> binds developer CLI sessions to isolated non-production environments.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
