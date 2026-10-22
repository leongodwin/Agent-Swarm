export interface DeliveryRecoveryInspection {
  scope:'local-delivery-startup';observedAt:string;owner:'absent'|'live-or-unverifiable'|'missing'|'invalid';
  history:'empty'|'retained'|'missing'|'invalid';canRecover:boolean;snapshotSha256?:string;reason:string;retainedInspectionAvailable?:boolean;
}
