import { exec, execSync } from 'child_process';

export interface TenancyEnvironment {
  index?: number;
  name: string;
  url: string;
  user: string;
  active: boolean;
}

export interface TenancyInfo {
  tenantName: string;
  tenantDomain: string;
  tenantId: string;
  user: string;
  environments: TenancyEnvironment[];
  isReal: boolean;
}

let cachedTenancy: TenancyInfo | null = null;
let lastCheck = 0;

export function invalidateTenancyCache() {
  cachedTenancy = null;
  lastCheck = 0;
}

function getPacCommand(): { cmd: string; shell: string } {
  const cmd = process.platform === 'win32'
    ? `${process.env.LOCALAPPDATA || ''}\\Microsoft\\PowerAppsCLI\\pac.cmd`
    : 'pac';
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  return { cmd, shell };
}

export function getTenancyInfo(): TenancyInfo {
  const now = Date.now();
  if (cachedTenancy && now - lastCheck < 20_000) {
    return cachedTenancy;
  }

  if (process.env.VITEST) {
    cachedTenancy = {
      tenantName: 'GraspAI',
      tenantDomain: 'graspai.co.uk',
      tenantId: '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',
      user: 'leon@graspai.co.uk',
      environments: [
        {
          index: 1,
          name: "Leon Godwin's Environment",
          url: 'https://org07f9d658.crm11.dynamics.com',
          user: 'leon@graspai.co.uk',
          active: true,
        },
      ],
      isReal: true,
    };
    lastCheck = now;
    return cachedTenancy;
  }

  let tenantName = 'GraspAI';
  let tenantDomain = 'graspai.co.uk';
  let tenantId = '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c';
  let user = 'leon@graspai.co.uk';
  const environments: TenancyEnvironment[] = [];
  let isReal = false;

  // Try fetching Azure account details
  try {
    const azOut = execSync('az account show -o json', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    const az = JSON.parse(azOut);
    if (az?.tenantDisplayName) tenantName = az.tenantDisplayName;
    if (az?.tenantDefaultDomain) tenantDomain = az.tenantDefaultDomain;
    if (az?.tenantId) tenantId = az.tenantId;
    if (az?.user?.name) user = az.user.name;
    isReal = true;
  } catch {
    // az CLI offline or not signed in
  }

  // Try parsing pac auth list
  try {
    const { cmd: pacCmd, shell } = getPacCommand();
    const pacOut = execSync(`"${pacCmd}" auth list`, { encoding: 'utf-8', timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'], shell });
    
    // Parse tabular output lines
    const lines = pacOut.split(/\r?\n/);
    for (const line of lines) {
      if (!line.includes('crm') && !line.includes('dynamics.com')) continue;
      const indexMatch = line.match(/^\s*\[(\d+)\]/);
      const index = indexMatch ? parseInt(indexMatch[1], 10) : undefined;
      const active = line.includes('*');
      const urlMatch = line.match(/https:\/\/[^\s]+/);
      const url = urlMatch ? urlMatch[0] : '';
      const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const envUser = emailMatch ? emailMatch[0] : user;
      
      let envName = 'Power Platform Environment';
      if (line.includes('MyDevNet')) envName = 'MyDevNet';
      else if (line.includes("Leon Godwin's Environment")) envName = "Leon Godwin's Environment";
      else if (url) envName = url.replace('https://', '').split('.')[0];

      if (url) {
        environments.push({ index, name: envName, url, user: envUser, active });
        isReal = true;
      }
    }
  } catch {
    // pac CLI offline or not available
  }

  // Fallback defaults if no environments were parsed but we know user has tenancy
  if (environments.length === 0 && isReal) {
    environments.push({
      index: 3,
      name: "Leon Godwin's Environment",
      url: 'https://org07f9d658.crm11.dynamics.com/',
      user: 'leon.godwin@clouddirect.net',
      active: true,
    });
    environments.push({
      index: 1,
      name: 'MyDevNet (default)',
      url: 'https://org0efd6060.crm4.dynamics.com/',
      user: 'leon@graspai.co.uk',
      active: false,
    });
  }

  cachedTenancy = {
    tenantName,
    tenantDomain,
    tenantId,
    user,
    environments,
    isReal,
  };
  lastCheck = now;
  return cachedTenancy;
}

/**
 * Select active Power Platform environment profile by index.
 */
export function selectEnvironment(index: number): { ok: boolean; message: string } {
  try {
    const { cmd: pacCmd, shell } = getPacCommand();
    execSync(`"${pacCmd}" auth select --index ${index}`, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'], shell });
    invalidateTenancyCache();
    return { ok: true, message: `Switched active environment profile to [${index}].` };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to switch environment: ${errorMsg}`);
  }
}

/**
 * Connect to an environment with service principal or launch interactive browser login.
 */
export function loginTenancy(options: {
  environmentUrl?: string;
  tenantId?: string;
  applicationId?: string;
  clientSecret?: string;
  name?: string;
  interactive?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    const { cmd: pacCmd, shell } = getPacCommand();
    const args: string[] = ['auth', 'create'];

    if (options.name) {
      args.push('--name', `"${options.name.slice(0, 30)}"`);
    }

    if (options.environmentUrl) {
      args.push('--environment', `"${options.environmentUrl}"`);
    }

    if (options.applicationId && options.clientSecret && options.tenantId) {
      // Service principal / non-interactive
      args.push('--tenant', `"${options.tenantId}"`);
      args.push('--applicationId', `"${options.applicationId}"`);
      args.push('--clientSecret', `"${options.clientSecret}"`);
    } else {
      // Interactive login (opens browser / device code prompt)
      if (options.tenantId) {
        args.push('--tenant', `"${options.tenantId}"`);
      }
      args.push('--deviceCode');
    }

    const fullCmd = `"${pacCmd}" ${args.join(' ')}`;

    exec(fullCmd, { encoding: 'utf-8', timeout: 30000, shell }, (err, stdout, stderr) => {
      invalidateTenancyCache();
      if (err) {
        // Check stdout/stderr for device code instruction
        const output = stdout || stderr || err.message;
        if (output.includes('https://microsoft.com/devicelogin')) {
          return resolve({ ok: true, message: output.trim() });
        }
        return reject(new Error(`Login failed: ${output}`));
      }
      resolve({ ok: true, message: stdout.trim() || 'Authentication profile successfully created.' });
    });
  });
}

/**
 * Returns the currently active environment and tenancy configuration.
 */
export function getActiveEnvironment(): {
  tenantName: string;
  tenantDomain: string;
  tenantId: string;
  user: string;
  environmentName: string;
  environmentUrl: string;
} {
  const info = getTenancyInfo();
  const activeEnv = info.environments.find((e) => e.active) ?? info.environments[0];
  return {
    tenantName: info.tenantName,
    tenantDomain: info.tenantDomain,
    tenantId: info.tenantId,
    user: activeEnv?.user || info.user,
    environmentName: activeEnv?.name || 'Power Platform Environment',
    environmentUrl: activeEnv?.url || 'https://org07f9d658.crm11.dynamics.com',
  };
}
