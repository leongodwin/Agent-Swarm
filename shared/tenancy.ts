export interface TenancyEnvironment { index?: number; name: string; url: string; user: string; active: boolean }
export interface TenancyInfo { tenantName: string; tenantDomain: string; tenantId: string; user: string; environments: TenancyEnvironment[]; isReal: boolean; status?: 'connected' | 'disconnected' | 'stale' | 'demo' }
export interface TenancyLoginInput { environmentUrl?: string; tenantId?: string; applicationId?: string; clientSecret?: string; name?: string; interactive?: boolean }
export interface TenancyLogin { id: string; status: 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled'; message: string; ok: boolean }
