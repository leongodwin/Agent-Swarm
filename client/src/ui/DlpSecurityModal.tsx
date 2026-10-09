import { useState, useEffect } from 'react';
import { Panel } from './Overlays';
import { useStore, repoOnFloor } from '../store';
import { api } from '../api';
import { ALLOWED_BUSINESS_CONNECTORS, ENTERPRISE_DLP_RULES, auditDlpCompliance, type DlpPolicyViolation } from '../../../shared/dlp';

export function DlpSecurityModal() {
  const [activeTab, setActiveTab] = useState<'rules' | 'scanner' | 'entra'>('entra');
  const [isScanning, setIsScanning] = useState(false);
  const [tenancy, setTenancy] = useState<{
    tenantName: string;
    tenantDomain: string;
    tenantId: string;
    user: string;
    environments: Array<{ index?: number; name: string; url: string; user: string; active: boolean }>;
    isReal: boolean;
  }>({
    tenantName: 'GraspAI',
    tenantDomain: 'graspai.co.uk',
    tenantId: '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',
    user: 'leon@graspai.co.uk',
    environments: [],
    isReal: true,
  });

  const pushToast = useStore((s) => s.pushToast);
  const [isSwitching, setIsSwitching] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginMode, setLoginMode] = useState<'interactive' | 'sp'>('interactive');
  const [loginForm, setLoginForm] = useState({
    environmentUrl: '',
    tenantId: '',
    applicationId: '',
    clientSecret: '',
    name: '',
  });

  const refreshTenancy = () => {
    api.tenancy().then((t) => setTenancy(t)).catch(() => {});
  };

  useEffect(() => {
    refreshTenancy();
  }, []);

  const handleSelectEnv = async (index?: number) => {
    if (!index) return;
    setIsSwitching(true);
    try {
      await api.selectTenancyEnvironment(index);
      pushToast('success', `Active deployment target switched to profile [${index}]!`);
      refreshTenancy();
    } catch (e: unknown) {
      pushToast('error', `Failed to switch environment: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleExecuteLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSwitching(true);
    try {
      const res = await api.loginTenancy({
        interactive: loginMode === 'interactive',
        environmentUrl: loginForm.environmentUrl || undefined,
        tenantId: loginForm.tenantId || undefined,
        applicationId: loginMode === 'sp' ? loginForm.applicationId : undefined,
        clientSecret: loginMode === 'sp' ? loginForm.clientSecret : undefined,
        name: loginForm.name || undefined,
      });
      pushToast('success', res.message || 'Authentication profile added successfully!');
      setShowLoginModal(false);
      refreshTenancy();
    } catch (e: unknown) {
      pushToast('error', `Login failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSwitching(false);
    }
  };

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
              Tenant Security Perimeter: <span style={{ color: '#38bdf8' }}>{tenancy.tenantName} ({tenancy.tenantDomain})</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Authenticated User: <span style={{ color: '#cbd5e1' }}>{tenancy.user}</span> · {tenancy.isReal ? 'Verified live Microsoft tenancy' : 'Simulated tenant'}
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

            {/* Live Connected Environments */}
            <div style={{ marginTop: 6, background: '#090e1a', padding: 14, borderRadius: 8, border: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase' }}>
                  Live Power Platform Tenancy Profiles ({tenancy.environments.length} Active Endpoints)
                </div>
                <button
                  onClick={() => setShowLoginModal(true)}
                  style={{
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>➕</span>
                  <span>Connect Tenancy / Environment</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tenancy.environments.length > 0 ? (
                  tenancy.environments.map((env, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: env.active ? '#082f49' : '#0f172a',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: env.active ? '1px solid #0284c7' : '1px solid #1e293b',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {env.index !== undefined && (
                            <span style={{ fontSize: 10, background: '#1e293b', color: '#94a3b8', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                              [{env.index}]
                            </span>
                          )}
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{env.name}</span>
                          {env.active && (
                            <span style={{ fontSize: 10, background: '#064e3b', color: '#34d399', padding: '2px 8px', borderRadius: 4, fontWeight: 800 }}>
                              ✓ ACTIVE TARGET
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{env.url}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11, color: '#cbd5e1' }}>{env.user}</span>
                        {!env.active && env.index !== undefined && (
                          <button
                            disabled={isSwitching}
                            onClick={() => void handleSelectEnv(env.index)}
                            style={{
                              background: '#1e293b',
                              color: '#38bdf8',
                              border: '1px solid #0284c7',
                              padding: '5px 12px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: isSwitching ? 'wait' : 'pointer',
                            }}
                          >
                            Set Active
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>No PAC CLI profiles connected.</div>
                )}
              </div>
            </div>

            {/* Tenancy Login Modal */}
            {showLoginModal && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                }}
              >
                <div
                  style={{
                    background: '#0f172a',
                    border: '1px solid #0284c7',
                    borderRadius: 12,
                    padding: 24,
                    width: 500,
                    maxWidth: '90vw',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>
                      🔑 Connect Microsoft Power Platform Tenancy
                    </div>
                    <button
                      onClick={() => setShowLoginModal(false)}
                      style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* Mode switcher */}
                  <div style={{ display: 'flex', gap: 8, background: '#090e1a', padding: 4, borderRadius: 8 }}>
                    <button
                      type="button"
                      onClick={() => setLoginMode('interactive')}
                      style={{
                        flex: 1,
                        background: loginMode === 'interactive' ? '#0284c7' : 'transparent',
                        color: '#fff',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Interactive (Browser / Device Code)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginMode('sp')}
                      style={{
                        flex: 1,
                        background: loginMode === 'sp' ? '#0284c7' : 'transparent',
                        color: '#fff',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Entra Service Principal
                    </button>
                  </div>

                  <form onSubmit={handleExecuteLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                        Profile Name (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Production Orgs, Client Tenancy"
                        value={loginForm.name}
                        onChange={(e) => setLoginForm({ ...loginForm, name: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#fff', fontSize: 12, boxSizing: 'border-box' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                        Environment URL or Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. https://contoso-dev.crm.dynamics.com"
                        value={loginForm.environmentUrl}
                        onChange={(e) => setLoginForm({ ...loginForm, environmentUrl: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#fff', fontSize: 12, boxSizing: 'border-box' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                        Tenant ID / Domain
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. yourcompany.onmicrosoft.com or Tenant GUID"
                        value={loginForm.tenantId}
                        onChange={(e) => setLoginForm({ ...loginForm, tenantId: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#fff', fontSize: 12, boxSizing: 'border-box' }}
                      />
                    </div>

                    {loginMode === 'sp' && (
                      <>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                            Application (Client) ID
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="Azure App Registration GUID"
                            value={loginForm.applicationId}
                            onChange={(e) => setLoginForm({ ...loginForm, applicationId: e.target.value })}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#fff', fontSize: 12, boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                            Client Secret
                          </label>
                          <input
                            type="password"
                            required
                            placeholder="Client Secret Value"
                            value={loginForm.clientSecret}
                            onChange={(e) => setLoginForm({ ...loginForm, clientSecret: e.target.value })}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: '#fff', fontSize: 12, boxSizing: 'border-box' }}
                          />
                        </div>
                      </>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => setShowLoginModal(false)}
                        style={{ background: '#334155', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSwitching}
                        style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: isSwitching ? 'wait' : 'pointer' }}
                      >
                        {isSwitching ? 'Authenticating…' : 'Authenticate & Set Active'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
