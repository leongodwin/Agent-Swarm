export interface HookToolDecision { status: 'allowed' | 'blocked' | 'unavailable'; reason: string; }
export function hookDecision(decision: HookToolDecision): Record<string, unknown> {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision.status === 'allowed' ? 'allow' : 'deny', permissionDecisionReason: decision.reason } };
}
export function hookFailure(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && (body as Record<string, unknown>).hook_event_name === 'PreToolUse'
    ? hookDecision({ status: 'unavailable', reason: 'Office governance unavailable; tool execution denied' }) : {};
}
