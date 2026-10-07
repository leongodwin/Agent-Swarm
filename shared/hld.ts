/**
 * High-Level Design (HLD) Architecture Types and Generator (Shared)
 */

export interface HldComponent {
  role: string;
  title: string;
  badge: string;
  details: string;
  deliverables: string[];
}

export interface HldInput {
  solutionName: string;
  problemContext: string;
  components: HldComponent[];
  tenantName?: string;
  repoPath?: string;
}

export interface HldResult {
  docId: string;
  generatedAt: number;
  solutionName: string;
  savedFilePath?: string;
  markdownContent: string;
  mermaidDiagrams: {
    topology: string;
    erd: string;
    sequence: string;
  };
}

export function generateHldContent(input: HldInput): HldResult {
  const docId = `HLD-${Date.now().toString(36).toUpperCase()}`;
  const tenant = input.tenantName || 'contoso.onmicrosoft.com';

  const topologyDiagram = `graph TB
    subgraph "1. Engagement Channels"
        Teams["Microsoft Teams & Mobile App"]
        Portal["Power Pages Customer Portal"]
        PCF["Custom Fluent UI PCF Controls"]
    end

    subgraph "2. Conversational & Agent Tier"
        Copilot["Copilot Studio Autonomous Bot"]
        GenAI["Azure OpenAI Generative Answers"]
        Guardrails["Content Safety & Guardrails Filter"]
    end

    subgraph "3. Process & Logic Tier"
        Flows["Power Automate Cloud Flows"]
        Approvals["Teams Adaptive Card Approvals"]
        Webhooks["Custom Connector REST APIs"]
    end

    subgraph "4. Enterprise Data & Storage Tier"
        DV["Microsoft Dataverse Relational Store"]
        Blob["Azure Secure Blob Storage"]
        Audit["Compliance & Audit Elastic Table"]
    end

    subgraph "5. Security & Governance"
        Entra["Microsoft Entra ID (SSO & CA)"]
        DLP["Power Platform DLP Policy Boundary"]
    end

    Teams --> Copilot
    Portal --> Copilot
    PCF --> DV
    Copilot --> GenAI
    GenAI --> Guardrails
    Copilot --> Flows
    Flows --> Approvals
    Flows --> Webhooks
    Flows --> DV
    DV --> Blob
    DV --> Audit
    Entra -.-> Copilot
    Entra -.-> Flows
    DLP -.-> Flows`;

  const erdDiagram = `erDiagram
    CR_INCIDENT ||--o{ CR_WORKORDER : generates
    CR_INCIDENT ||--o{ CR_ATTACHMENT : contains
    CR_EQUIPMENT ||--o{ CR_INCIDENT : affected
    CR_AGENT_AUDIT }o--|| CR_WORKORDER : tracks

    CR_INCIDENT {
        guid cr_incidentid PK
        string cr_title
        string cr_severity
        int cr_statuscode
        datetime cr_createdon
        string cr_copilot_sentiment
    }

    CR_WORKORDER {
        guid cr_workorderid PK
        guid cr_incidentid FK
        string cr_assigned_technician
        decimal cr_estimated_cost
        string cr_approval_state
    }

    CR_EQUIPMENT {
        guid cr_equipmentid PK
        string cr_serial_number
        string cr_model
        string cr_location_geo
    }

    CR_ATTACHMENT {
        guid cr_attachmentid PK
        guid cr_incidentid FK
        string cr_file_url
        string cr_pcf_annotation_json
    }

    CR_AGENT_AUDIT {
        guid cr_auditid PK
        guid cr_workorderid FK
        string cr_trigger_source
        int cr_flow_duration_ms
        string cr_dlp_evaluation_result
    }`;

  const sequenceDiagram = `sequenceDiagram
    autonumber
    actor User as User / Technician
    participant Teams as Microsoft Teams
    participant Copilot as Copilot Studio
    participant Flow as Power Automate
    participant DV as Dataverse API
    participant Manager as Supervisor (Teams)

    User->>Teams: Initiate Prompt / Field Incident
    Teams->>Copilot: Send Activity Payload (SSO Token)
    Copilot->>Copilot: Match Topic & Extract Entities
    Copilot->>Flow: Trigger Cloud Flow (DispatchWorkOrder)
    Flow->>DV: Query Equipment & Create cr_incident
    DV-->>Flow: Return Incident ID & SLA Tier
    Flow->>Manager: Post Adaptive Card Approval
    Manager->>Flow: Approve / Modify Cost Estimate
    Flow->>DV: Update cr_workorder status (Approved)
    Flow-->>Copilot: Return Execution Confirmation
    Copilot-->>Teams: Render Formatted Result Card
    Teams-->>User: Display Work Order Dispatched Confirmation`;

  const markdownContent = `# High-Level Design (HLD): ${input.solutionName}

**Document ID:** \`${docId}\`  
**Tenant Boundary:** \`${tenant}\`  
**Framework:** Microsoft Well-Architected Framework for Power Platform  
**Status:** Approved for Implementation  
**Created:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}  

---

## 1. Executive Architecture Overview

### 1.1 Business Context & Problem Statement
${input.problemContext}

### 1.2 Architectural Principles
This solution is designed in accordance with Microsoft cloud architecture standards:
- **Zero Trust Security:** Explicit validation using Microsoft Entra ID Conditional Access and least-privilege security roles in Dataverse.
- **Composable Fusion Development:** Low-code conversational models in Copilot Studio coupled with pro-code custom PCF controls.
- **Automated ALM:** All components managed in unpacked Git repositories (\`pac solution unpack\`) with automated validation gates.

---

## 2. Logical Component Architecture

\`\`\`mermaid
${topologyDiagram}
\`\`\`

### 2.1 Architectural Tier Breakdown
${input.components
  .map(
    (c, idx) => `#### 2.1.${idx + 1} ${c.title} (\`${c.badge}\`)
- **Assigned Specialist Role:** ${c.role}
- **Functional Scope:** ${c.details}
- **Target Deliverables:** ${c.deliverables.join(', ')}
`,
  )
  .join('\n')}

---

## 3. Data Architecture & Dataverse Entity Model (ERD)

The data tier is deployed on Microsoft Dataverse, leveraging relational tables, optimistic concurrency, and automated audit logging.

\`\`\`mermaid
${erdDiagram}
\`\`\`

### 3.1 Data Retention & Column-Level Security
- **Confidential Fields:** Cost estimates and technician identities are protected via Dataverse Column Security Profiles.
- **Elastic Tables:** High-frequency agent activity logs (\`cr_agent_audit\`) utilize Dataverse Elastic Tables to ensure scalable throughput without consuming transactional capacity.

---

## 4. End-to-End Sequence & Integration Topology

\`\`\`mermaid
${sequenceDiagram}
\`\`\`

---

## 5. Security, Identity & Data Loss Prevention (DLP)

### 5.1 Authentication & Authorization
- **Identity Provider:** Microsoft Entra ID.
- **User Authentication:** OAuth 2.0 On-Behalf-Of (OBO) flow when delegating from Microsoft Teams to Copilot Studio.
- **Server-to-Server Authentication:** Azure Service Principal registered with \`PowerApps-Advisor\` and Dataverse Application User roles.

### 5.2 DLP Policy Alignment
- **Business Group Connectors:** Microsoft Teams, Microsoft Dataverse, Office 365 Users, SharePoint, Approvals.
- **Blocked Connectors:** Public social media, consumer cloud drives, and unverified third-party HTTP endpoints.

---

## 6. Application Lifecycle Management (ALM) & Deployment Strategy

\`\`\`
[Git Feature Branch] ---> [pac solution unpack] ---> [PR Quality Gate]
                                                            |
                                                            v
[Production Environment] <--- [3D Manager Approval] <--- [Deploy to Test]
\`\`\`

1. **Source Control Structure:** Unpacked solution components stored under \`/SolutionPackage/src/\`.
2. **Pull Request Quality Gates:**
   - \`pac solution check\` (SARIF analysis with zero critical errors).
   - Automated DLP connector validation.
   - Vitest and Playwright regression test suite execution.
3. **Multi-Environment Promotion:**
   - Solution packed as **Managed** and deployed to Test.
   - Manager reviews release dashboard in 3D office and presses \`[E]\` to approve Production cutover.

---

## 7. Reliability & Operational Governance

- **Service Protection Limits:** Cloud flows incorporate exponential backoff with a maximum of 5 retries.
- **Dead-Letter Handling:** Failed asynchronous runs automatically route to the Tier-2 Support Escalation flow with Teams alert.
- **Health Telemetry:** Real-time run duration and error telemetry streamed to the office Flow Run History board.

---
*Generated by Swarm Principal Solutions Architect Agent*
`;

  return {
    docId,
    generatedAt: Date.now(),
    solutionName: input.solutionName,
    markdownContent,
    mermaidDiagrams: {
      topology: topologyDiagram,
      erd: erdDiagram,
      sequence: sequenceDiagram,
    },
  };
}
