import {expect,it} from 'vitest';
import {generateProposal,proposalInputSchema,type ProposalInput} from './proposals';
const input:ProposalInput={title:'Scenario',clientName:'Client',industry:'Services',problemStatement:'Requirements',userCount:1,monthlyTransactions:100,complianceTier:'standard',targetChannels:[],integrationPoints:[]};
const commercial:NonNullable<ProposalInput['commercial']>={currency:'GBP',licensing:[{sku:'Customer licence line',category:'App',quantity:1,unitPriceMonthly:10,notes:'Unverified scenario assumption'}],implementationCost:1000,monthlyOtherOperatingCost:10,minutesSavedPerTransaction:6,hourlyCost:12,timelineWeeks:4};

it('calculates only supplied scenario costs and retains their provenance',()=>{
  const result=generateProposal({...input,commercial});
  expect(result).toMatchObject({currency:'GBP',totalMonthlyLicenseCost:10,annualLicenseCost:120,implementationCostEstimate:1000,projectedAnnualSavings:1440,threeYearRoiPercent:151.16,estimatedTimelineWeeks:4});
  expect(result.licensingBOM[0].notes).toBe('Unverified scenario assumption');expect(result.markdownContent).toContain('no budget, compliance or deployment approval');
  result.licensingBOM[0].notes='Changed output';expect(commercial.licensing![0].notes).toBe('Unverified scenario assumption');
});

it('preserves negative ROI and assigns no ROI to a zero or incomplete cost basis',()=>{
  const negative=generateProposal({...input,monthlyTransactions:1,commercial:{...commercial,licensing:[{...commercial.licensing![0],unitPriceMonthly:100}],minutesSavedPerTransaction:1,hourlyCost:1,monthlyOtherOperatingCost:0}});
  expect(negative.threeYearRoiPercent).toBe(-99.99);
  const zero=generateProposal({...input,commercial:{...commercial,licensing:[{...commercial.licensing![0],quantity:0}],implementationCost:0,monthlyOtherOperatingCost:0}});
  expect(zero.totalMonthlyLicenseCost).toBe(0);expect(zero.threeYearRoiPercent).toBeNull();
  expect(generateProposal({...input,commercial:{...commercial,monthlyOtherOperatingCost:undefined}}).threeYearRoiPercent).toBeNull();
});

it('leaves unprovided benefits unknown and preserves zero-volume assumptions without increasing population',()=>{
  expect(generateProposal({...input,monthlyTransactions:null,commercial}).projectedAnnualSavings).toBeNull();
  expect(generateProposal({...input,commercial:{currency:'EUR'}}).projectedAnnualSavings).toBeNull();
  const zero=generateProposal({...input,userCount:0,monthlyTransactions:0,commercial});
  expect(zero.projectedAnnualSavings).toBe(0);expect(zero.markdownContent).toContain('Users supplied: 0');
});

it('rejects malformed, negative, non-finite and precision-overflow assumptions',()=>{
  for(const value of [-1,Infinity,NaN])expect(proposalInputSchema.safeParse({...input,commercial:{...commercial,implementationCost:value}}).success).toBe(false);
  expect(proposalInputSchema.safeParse({...input,commercial:{...commercial,licensing:[]}}).success).toBe(false);
  expect(proposalInputSchema.safeParse({...input,commercial:{...commercial,currency:'unsupported'}}).success).toBe(false);
  expect(proposalInputSchema.safeParse({...input,monthlyTransactions:1_000_000_000,commercial:{...commercial,minutesSavedPerTransaction:1440,hourlyCost:1000000}}).success).toBe(false);
  expect(proposalInputSchema.safeParse({...input,monthlyTransactions:1_000_000,commercial:{...commercial,licensing:[{...commercial.licensing![0],quantity:0}],implementationCost:.01,monthlyOtherOperatingCost:0,minutesSavedPerTransaction:60,hourlyCost:1_000_000}}).success).toBe(false);
});

it('rounds decimal licence products half up without binary floating-point errors',()=>{
  const result=generateProposal({...input,commercial:{currency:'GBP',licensing:[{...commercial.licensing![0],quantity:3,unitPriceMonthly:1.005}]}});
  expect(result.licensingBOM[0].totalMonthly).toBe(3.02);
  const fraction=generateProposal({...input,commercial:{currency:'GBP',licensing:[{...commercial.licensing![0],quantity:.5,unitPriceMonthly:.01}]}});
  expect(fraction.totalMonthlyLicenseCost).toBe(.01);
});
