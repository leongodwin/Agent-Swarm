import type { HldInput, HldResult } from './hld';

const label = (value: string) => value.replace(/["<>\\\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();

/** A scoped draft, never architecture approval or proof of model synthesis. */
export function generateHldContent(input: HldInput): HldResult {
  const generatedAt = Date.now(), docId = `HLD-${crypto.randomUUID()}`;
  const components = input.components.map(component => ({...component, deliverables: [...component.deliverables]}));
  const missingEvidence = [
    ...(input.tenantName ? [] : ['Target tenant has not been supplied.']),
    'Target environment URL and authenticated identity need verification.',
    ...(components.length ? [] : ['Component scope and deliverables have not been supplied.']),
    'Entity/column contracts, relationships, ownership and retention are not supplied.',
    'Workflow actors, triggers, transitions, failure paths and connector bindings need design.',
    'Effective permissions, tenant DLP decisions, licensing and capacity need live validation.',
    'Independent architecture review, acceptance tests and deployment/recovery evidence are missing.',
  ];
  const implementationPlan = [
    {id:'requirements', title:'Confirm requirements and delivery target', deliverables:['Reviewed requirement-to-acceptance matrix','Explicit tenant/environment and platform scope'],
      acceptance:['Confirm requirements with their owner.','Identify unsupported or paused platforms and unresolved decisions.']},
    ...components.map((component,index) => ({id:`component-${index+1}`, title:component.title, deliverables:component.deliverables,
      acceptance:['Approve the component contract and prerequisites before implementation.','Implement each declared deliverable and capture relevant build, API and UI test evidence.']})),
    {id:'verification', title:'Independently verify the combined solution', deliverables:['QA evidence linked to the exact source and artifact','Permission, integration and recovery results'],
      acceptance:['Exercise allowed and denied access with suitable accounts.','Verify persistence and failure recovery using disposable fixtures.']},
    {id:'deployment', title:'Deploy to the approved target and verify runtime behavior', deliverables:['Versioned release package and deployment record','Runtime verification and operational handover'],
      acceptance:['Require fresh schema, DLP, authentication, licensing and binding decisions.','Rehearse recovery separately and verify the deployed acceptance journeys.']},
  ];
  const topology = ['flowchart TB', `  Scope["${label(input.solutionName)} — declared scope"]`,
    ...components.flatMap((component,index) => [`  C${index}["${label(component.title)}"]`,`  Scope -.-> C${index}`]),
    ...(components.length ? [] : ['  Pending["Component scope not supplied"]','  Scope -.-> Pending'])].join('\n');
  const erd = 'flowchart LR\n  Pending["Data model pending: supply entities, keys, relationships and column contracts"]';
  const sequence = 'flowchart LR\n  Pending["Workflow pending: confirm actors, triggers, transitions and failure paths"]';
  const markdownContent = `# Architecture draft: ${input.solutionName}

**Document ID:** ${docId}  
**Status:** Draft — unreviewed; no implementation or deployment approval  
**Generation:** Deterministic requirements template; no model synthesis  
**Tenant supplied:** ${input.tenantName || 'Not supplied'} (not verified)  
**Created:** ${new Date(generatedAt).toISOString()}

## Requirements

${input.problemContext}

## Declared component scope

${components.length ? components.map(component => `### ${component.title}
Role requested: ${component.role}  
Platform/category supplied: ${component.badge}

${component.details}

Deliverables supplied:
${component.deliverables.length ? component.deliverables.map(item => `- ${item}`).join('\n') : '- Not supplied.'}`).join('\n\n') : 'No components have been supplied. Do not infer a platform or data model from a project name.'}

The diagram groups supplied components. Connections, deployment tiers and runtime integrations are not established.

\`\`\`mermaid
${topology}
\`\`\`

## Evidence and decisions required

${missingEvidence.map(item => `- ${item}`).join('\n')}

No entity names, keys, connector classifications, authentication flows or role grants are inferred by this draft.

## Implementation plan — review required

${implementationPlan.map(step => `### ${step.title}
Deliverables:
${step.deliverables.length ? step.deliverables.map(item => `- ${item}`).join('\n') : '- Define deliverables before implementation.'}

Acceptance:
${step.acceptance.map(item => `- ${item}`).join('\n')}`).join('\n\n')}

## Review and release gates

Validate the actual Dataverse schema, effective permissions and applicable tenant DLP policies before governed execution. Confirm authentication, licences, capacity, connector bindings and the target environment. Define accessibility and usability acceptance for the chosen app type. Record build/test results, independent QA, target runtime verification, documentation and recovery evidence against the release artifact.

No licence quote, delivery duration, savings, compliance certification or deployment status is established here. Full HLD-and-plan synthesis duration must be measured through the actual synthesis and persistence workflow; rendering this template does not satisfy that metric.
`;
  return {docId, generatedAt, solutionName:input.solutionName, status:'draft', generationMethod:'requirements-template', missingEvidence, implementationPlan,
    markdownContent, mermaidDiagrams:{topology,erd,sequence}};
}
