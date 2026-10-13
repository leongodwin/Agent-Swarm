import {z} from 'zod';
const text=z.string().trim().min(1).max(8000);
const amount=z.number().finite().nonnegative().max(1_000_000_000_000);
export const licenseScenarioSchema=z.object({sku:z.string().trim().min(1).max(200),category:z.string().trim().min(1).max(80),quantity:z.number().finite().nonnegative().max(100000),unitPriceMonthly:z.number().finite().nonnegative().max(100000),notes:z.string().trim().min(1).max(2000)}).strict();
export const proposalInputSchema=z.object({title:text,clientName:text,industry:text,problemStatement:text,
  userCount:z.number().int().nonnegative().max(1_000_000).nullable(),monthlyTransactions:z.number().int().nonnegative().max(1_000_000_000).nullable(),
  complianceTier:z.enum(['standard','hipaa','financial']),targetChannels:z.array(z.string().trim().min(1).max(500)).max(100),integrationPoints:z.array(z.string().trim().min(1).max(500)).max(100),
  commercial:z.object({currency:z.enum(['GBP','USD','EUR']),licensing:z.array(licenseScenarioSchema).min(1).max(100).optional(),implementationCost:amount.optional(),monthlyOtherOperatingCost:amount.optional(),
    timelineWeeks:z.number().int().positive().max(520).optional(),minutesSavedPerTransaction:z.number().finite().nonnegative().max(1440).optional(),hourlyCost:z.number().finite().nonnegative().max(1000000).optional()}).strict().optional(),
}).strict().superRefine((input,context)=>{
  const commercial=input.commercial;
  if(input.monthlyTransactions!==null&&commercial?.minutesSavedPerTransaction!==undefined&&commercial.hourlyCost!==undefined) {
    const total=input.monthlyTransactions*12*commercial.minutesSavedPerTransaction/60*commercial.hourlyCost;
    if(!Number.isSafeInteger(Math.round(total*100)))context.addIssue({code:'custom',path:['commercial','hourlyCost'],message:'Scenario total exceeds supported financial precision'});
    else if(commercial.licensing&&commercial.implementationCost!==undefined&&commercial.monthlyOtherOperatingCost!==undefined) {
      const monthly=money(commercial.licensing.reduce((sum,item)=>sum+moneyFactors([item.quantity,item.unitPriceMonthly]),0));
      const cost=money((money(monthly*12)+commercial.monthlyOtherOperatingCost*12)*3+commercial.implementationCost);
      const savings=moneyFactors([input.monthlyTransactions,12,commercial.minutesSavedPerTransaction,commercial.hourlyCost],60);
      if(cost>0&&!Number.isSafeInteger(Math.round((savings*3-cost)/cost*10000)))context.addIssue({code:'custom',path:['commercial','hourlyCost'],message:'Scenario ROI exceeds supported percentage precision'});
    }
  }
});
export type ProposalInput=z.infer<typeof proposalInputSchema>;
export interface LicenseCostItem {sku:string;category:string;quantity:number;unitPriceMonthly:number;totalMonthly:number;notes:string;}
export interface SprintItem {sprint:number;title:string;weeks:string;deliverables:string[];}
export interface ProposalResult {
  proposalId:string;generatedAt:number;title:string;clientName:string;status:'draft';generationMethod:'commercial-scenario';currency:'GBP'|'USD'|'EUR';
  executiveSummary:string;licensingBOM:LicenseCostItem[];totalMonthlyLicenseCost:number|null;annualLicenseCost:number|null;implementationCostEstimate:number|null;
  estimatedTimelineWeeks:number|null;projectedAnnualSavings:number|null;threeYearRoiPercent:number|null;sprintRoadmap:SprintItem[];missingEvidence:string[];markdownContent:string;
}
function moneyFactors(values:number[],divisor=1) {
  let numerator=100n,denominator=BigInt(divisor);
  for(const value of values) {
    if(!Number.isFinite(value)||value<0)throw new Error('Invalid monetary scenario');
    const [digits,exponent='0']=value.toString().split('e');const [whole,fraction='']=digits.split('.');
    numerator*=BigInt(whole+fraction);
    const scale=fraction.length-Number(exponent);
    if(scale>=0)denominator*=10n**BigInt(scale);else numerator*=10n**BigInt(-scale);
  }
  const cents=(numerator+denominator/2n)/denominator;
  if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Scenario total exceeds supported financial precision');
  return Number(cents)/100;
}
const money=(value:number)=>moneyFactors([value]);
export function generateProposal(raw:ProposalInput):ProposalResult {
  const input=proposalInputSchema.parse(raw),generatedAt=Date.now(),proposalId=`PROP-${crypto.randomUUID()}`;
  const commercial=input.commercial,currency=commercial?.currency??'GBP';
  const licensingBOM=(commercial?.licensing??[]).map(item=>({...item,totalMonthly:moneyFactors([item.quantity,item.unitPriceMonthly])}));
  const totalMonthlyLicenseCost=licensingBOM.length?money(licensingBOM.reduce((sum,item)=>sum+item.totalMonthly,0)):null;
  const annualLicenseCost=totalMonthlyLicenseCost===null?null:money(totalMonthlyLicenseCost*12);
  const implementationCostEstimate=commercial?.implementationCost??null;
  const estimatedTimelineWeeks=commercial?.timelineWeeks??null;
  const projectedAnnualSavings=input.monthlyTransactions!==null&&commercial?.minutesSavedPerTransaction!==undefined&&commercial.hourlyCost!==undefined
    ?moneyFactors([input.monthlyTransactions,12,commercial.minutesSavedPerTransaction,commercial.hourlyCost],60):null;
  const cost=annualLicenseCost!==null&&implementationCostEstimate!==null&&commercial?.monthlyOtherOperatingCost!==undefined
    ?money((annualLicenseCost+commercial.monthlyOtherOperatingCost*12)*3+implementationCostEstimate):null;
  const threeYearRoiPercent=cost!==null&&cost>0&&projectedAnnualSavings!==null?Math.round((projectedAnnualSavings*3-cost)/cost*10000)/100:null;
  const missingEvidence=[
    ...(totalMonthlyLicenseCost===null?['Licence quantities, prices and source references have not been supplied.']:['Licence prices are user-supplied scenario inputs; current quotes and actual entitlements are unverified.']),
    ...(implementationCostEstimate===null?['Implementation cost has not been supplied.']:[]),
    ...(estimatedTimelineWeeks===null?['Delivery duration has not been estimated by the delivery team.']:[]),
    ...(projectedAnnualSavings===null?['Transaction volume, time saved and hourly cost are required for a savings scenario.']:['Savings assumptions need an observed baseline and stakeholder validation.']),
    ...(commercial?.monthlyOtherOperatingCost===undefined?['Other recurring operating costs are not supplied; ROI cannot be estimated.']:[]),
    'Platform scope, capacity, tax, discounts, contract terms and deployment budget require review.',
    'A compliance review category is a requirement, not certification or proof of implemented controls.',
  ];
  const sprintRoadmap=[
    {sprint:1,title:'Requirements, architecture and commercial review',weeks:'Unscheduled',deliverables:['Approve requirements and architecture scope.','Validate quotes, entitlements, capacity and budget.']},
    {sprint:2,title:'Implementation and independent verification',weeks:'Unscheduled',deliverables:['Use verified installed platform skills for the approved components.','Capture build, permission, integration, UX and recovery evidence.']},
    {sprint:3,title:'Governed deployment and operational handover',weeks:'Unscheduled',deliverables:['Require fresh schema, DLP, authentication and binding decisions.','Verify the deployed acceptance journeys and document operation/recovery.']},
  ];
  const formatted=(value:number|null)=>value===null?'Not estimated':`${currency} ${value.toFixed(2)}`;
  const executiveSummary=`Draft scope for ${input.clientName}: ${input.problemStatement} Architecture, commercial assumptions and acceptance require review.`;
  const markdownContent=`# Commercial scenario draft: ${input.title}

**Reference:** ${proposalId}  
**Client supplied:** ${input.clientName}  
**Industry supplied:** ${input.industry}  
**Status:** Draft — unreviewed; no budget, compliance or deployment approval  
**Generation:** Deterministic user-input scenario; no model synthesis  
**Display currency:** ${currency}; no exchange conversion or verified price feed  
**Created:** ${new Date(generatedAt).toISOString()}

## Declared requirements

${input.problemStatement}

Users supplied: ${input.userCount??'Not supplied'}  
Monthly transactions supplied: ${input.monthlyTransactions??'Not supplied'}  
Compliance review category requested: ${input.complianceTier} (not certification)  
Channels supplied: ${input.targetChannels.join(', ')||'None supplied'}  
Integrations supplied: ${input.integrationPoints.join(', ')||'None supplied'}

No platform, SKU, connector, authentication pattern or implemented security control is inferred from these inputs.

## User-supplied licence scenario

${licensingBOM.length?licensingBOM.map(item=>`- ${item.sku} (${item.category}): ${item.quantity} × ${currency} ${item.unitPriceMonthly} / month = ${formatted(item.totalMonthly)}. Source/assumption: ${item.notes}`).join('\n'):'No licence prices or entitlements have been supplied.'}

Monthly licence scenario: ${formatted(totalMonthlyLicenseCost)}  
Annual licence scenario: ${formatted(annualLicenseCost)}  
Implementation cost supplied: ${formatted(implementationCostEstimate)}  
Delivery duration supplied: ${estimatedTimelineWeeks===null?'Not estimated':`${estimatedTimelineWeeks} weeks; unvalidated`}  
Annual savings scenario: ${formatted(projectedAnnualSavings)}  
Three-year ROI scenario: ${threeYearRoiPercent===null?'Not estimated':`${threeYearRoiPercent}%`}

ROI = (three years of supplied savings − three years of supplied licence/other operating costs − supplied implementation cost) / total supplied costs. Negative ROI is retained. A zero or incomplete cost basis is not assigned an ROI. Monetary products are calculated from supplied decimal values and rounded half up to two decimals. This model does not establish payback, realised savings, tax treatment, compliance or licence suitability.

## Evidence and decisions required

${missingEvidence.map(item=>`- ${item}`).join('\n')}

## Delivery outline — unscheduled and unapproved

${sprintRoadmap.map(item=>`### ${item.title}\n${item.deliverables.map(deliverable=>`- ${deliverable}`).join('\n')}`).join('\n\n')}
`;
  return {proposalId,generatedAt,title:input.title,clientName:input.clientName,status:'draft',generationMethod:'commercial-scenario',currency,executiveSummary,
    licensingBOM,totalMonthlyLicenseCost,annualLicenseCost,implementationCostEstimate,estimatedTimelineWeeks,projectedAnnualSavings,threeYearRoiPercent,sprintRoadmap,missingEvidence,markdownContent};
}
