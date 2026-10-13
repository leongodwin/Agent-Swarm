import type {PullInfo, QaView} from './types';

/** A prior pass alone cannot describe the current PR as approved. */
export function currentQaApproval(qa: Pick<QaView, 'status' | 'passedSha'> | undefined, pull: Pick<PullInfo, 'state' | 'headSha'> | undefined): boolean {
  return !!qa?.passedSha && qa.status === 'passed' && pull?.state === 'OPEN' && qa.passedSha === pull.headSha;
}
