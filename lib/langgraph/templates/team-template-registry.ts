import type {
  ApprovalSensitivity,
  SwarmTeamType,
  TeamBlueprintRole
} from "../state.ts";
import { buildRolePrompt } from "./prompt-generator.ts";

export interface TeamTemplate {
  teamType: SwarmTeamType;
  objective: string;
  collaborationStyle: string;
  sharedMemoryScope: string;
  approvalSensitivity: ApprovalSensitivity;
  successCriteria: string[];
  toolCategories: string[];
  exampleDeliverables: string[];
  roles: TeamBlueprintRole[];
}

function roleTemplate(input: {
  roleName: string;
  description: string;
  responsibilities: string[];
  defaultInitialTasks: string[];
  toolCategories: string[];
  collaborationStyle: string;
  approvalSensitivity: ApprovalSensitivity;
  exampleDeliverables: string[];
}): TeamBlueprintRole {
  return {
    roleName: input.roleName,
    description: input.description,
    responsibilities: input.responsibilities,
    defaultInitialTasks: input.defaultInitialTasks,
    toolCategories: input.toolCategories,
    collaborationStyle: input.collaborationStyle,
    approvalSensitivity: input.approvalSensitivity,
    exampleDeliverables: input.exampleDeliverables
  };
}

const TEAM_TEMPLATE_REGISTRY: Record<SwarmTeamType, TeamTemplate> = {
  marketing: {
    teamType: "marketing",
    objective: "Design, execute, and optimize growth campaigns aligned with company goals.",
    collaborationStyle: "Weekly strategy sync with daily async progress updates.",
    sharedMemoryScope: "org.team.marketing.shared",
    approvalSensitivity: "MEDIUM",
    successCriteria: [
      "Campaign plan with target segments and channels",
      "Content calendar with accountable owners",
      "Performance baseline and optimization loop"
    ],
    toolCategories: ["analytics", "social", "docs", "communication", "research"],
    exampleDeliverables: [
      "Campaign strategy brief",
      "Channel content schedule",
      "Performance dashboard snapshot"
    ],
    roles: [
      roleTemplate({
        roleName: "Marketing Strategist",
        description: "Defines positioning, campaign goals, and execution priorities.",
        responsibilities: [
          "Translate business goals into campaign strategy",
          "Define channel mix, KPIs, and guardrails",
          "Coordinate dependencies across team roles"
        ],
        defaultInitialTasks: [
          "Draft a 30-day marketing mission plan",
          "Define campaign KPIs and reporting cadence"
        ],
        toolCategories: ["analytics", "docs", "research"],
        collaborationStyle: "Lead strategy sync and decision logs.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Marketing strategy document", "KPI tracker definition"]
      }),
      roleTemplate({
        roleName: "Content Strategist",
        description: "Builds messaging architecture and editorial pipeline.",
        responsibilities: [
          "Develop content pillars and topic map",
          "Plan channel-specific content cadence",
          "Collaborate with brand and social roles"
        ],
        defaultInitialTasks: [
          "Create content pillar matrix",
          "Draft weekly editorial calendar"
        ],
        toolCategories: ["content", "docs", "research"],
        collaborationStyle: "Asynchronous content checkpoints with strategist feedback.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Editorial calendar", "Messaging framework"]
      }),
      roleTemplate({
        roleName: "Social Media Manager",
        description: "Turns strategy into social channel execution and feedback loops.",
        responsibilities: [
          "Map content to channel formats",
          "Schedule publishing plan and engagement loop",
          "Track audience response signals"
        ],
        defaultInitialTasks: [
          "Build channel-by-channel publishing plan",
          "Define response and escalation playbook"
        ],
        toolCategories: ["social", "content", "communication"],
        collaborationStyle: "Daily progress updates in Hub with blockers and dependencies.",
        approvalSensitivity: "HIGH",
        exampleDeliverables: ["Social posting matrix", "Engagement playbook"]
      }),
      roleTemplate({
        roleName: "Performance Analyst",
        description: "Monitors campaign metrics and recommends optimization actions.",
        responsibilities: [
          "Define measurement model and baselines",
          "Analyze conversion and retention performance",
          "Publish optimization recommendations"
        ],
        defaultInitialTasks: [
          "Set baseline metrics for current campaigns",
          "Draft optimization hypothesis backlog"
        ],
        toolCategories: ["analytics", "research"],
        collaborationStyle: "Evidence-first updates with metric snapshots.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Performance report", "Optimization backlog"]
      }),
      roleTemplate({
        roleName: "Brand Researcher",
        description: "Collects market and competitor insight for campaign quality.",
        responsibilities: [
          "Gather competitive signal and audience trends",
          "Identify positioning opportunities",
          "Share reusable research assets in Hub"
        ],
        defaultInitialTasks: [
          "Compile competitor messaging snapshot",
          "Publish audience trend brief"
        ],
        toolCategories: ["research", "docs"],
        collaborationStyle: "Research-first workflow with references attached.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Competitive landscape brief", "Audience trend memo"]
      })
    ]
  },
  sales: {
    teamType: "sales",
    objective: "Build a qualified pipeline and predictable outbound follow-up rhythm.",
    collaborationStyle: "Daily standup with pipeline state updates.",
    sharedMemoryScope: "org.team.sales.shared",
    approvalSensitivity: "HIGH",
    successCriteria: [
      "Target account list with qualification criteria",
      "Outreach sequence with role ownership",
      "Pipeline insight report and next actions"
    ],
    toolCategories: ["crm", "communication", "analytics", "docs", "research"],
    exampleDeliverables: [
      "Qualified lead list",
      "Outreach sequence drafts",
      "Pipeline performance summary"
    ],
    roles: [
      roleTemplate({
        roleName: "Sales Strategist",
        description: "Owns pipeline strategy and revenue-focused sequencing.",
        responsibilities: [
          "Define ICP and qualification model",
          "Set pipeline targets and sequencing priorities",
          "Coordinate handoffs across sales roles"
        ],
        defaultInitialTasks: [
          "Define ICP and lead qualification criteria",
          "Create pipeline stage success definitions"
        ],
        toolCategories: ["crm", "analytics", "docs"],
        collaborationStyle: "Pipeline review cadence with explicit next actions.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Pipeline strategy brief", "Qualification matrix"]
      }),
      roleTemplate({
        roleName: "Lead Research Agent",
        description: "Discovers and enriches lead/account intelligence.",
        responsibilities: [
          "Build target account and contact lists",
          "Research account context and trigger events",
          "Publish lead briefs for outreach role"
        ],
        defaultInitialTasks: [
          "Build initial account target list",
          "Publish enrichment notes for top leads"
        ],
        toolCategories: ["research", "crm"],
        collaborationStyle: "Structured lead briefs in Hub for downstream reuse.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Lead dossier", "Account context notes"]
      }),
      roleTemplate({
        roleName: "Outreach Copy Agent",
        description: "Produces channel-ready outbound messaging.",
        responsibilities: [
          "Draft personalized outreach copy",
          "Align messaging to ICP pain points",
          "Iterate copy from response signals"
        ],
        defaultInitialTasks: [
          "Draft outreach templates by segment",
          "Prepare A/B subject and CTA variants"
        ],
        toolCategories: ["content", "communication", "docs"],
        collaborationStyle: "Fast iteration loop informed by pipeline data.",
        approvalSensitivity: "HIGH",
        exampleDeliverables: ["Outbound template set", "A/B copy matrix"]
      }),
      roleTemplate({
        roleName: "CRM Follow-up Agent",
        description: "Maintains CRM state and follow-up consistency.",
        responsibilities: [
          "Update CRM activity and follow-up schedules",
          "Detect stale opportunities and reactivation points",
          "Publish follow-up risk list"
        ],
        defaultInitialTasks: [
          "Audit follow-up gaps across active opportunities",
          "Create next-touch schedule recommendations"
        ],
        toolCategories: ["crm", "analytics", "communication"],
        collaborationStyle: "Operational logging with explicit owner and deadline.",
        approvalSensitivity: "HIGH",
        exampleDeliverables: ["Follow-up queue", "CRM hygiene report"]
      }),
      roleTemplate({
        roleName: "Pipeline Analyst",
        description: "Tracks pipeline quality and conversion economics.",
        responsibilities: [
          "Measure stage conversion and velocity",
          "Surface risk/opportunity segments",
          "Recommend weekly optimization priorities"
        ],
        defaultInitialTasks: [
          "Build pipeline health snapshot",
          "Publish stage conversion bottlenecks"
        ],
        toolCategories: ["analytics", "crm", "docs"],
        collaborationStyle: "Metric narrative with action-oriented recommendations.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Pipeline analytics brief", "Funnel bottleneck report"]
      })
    ]
  },
  research: {
    teamType: "research",
    objective: "Produce evidence-backed insights and actionable strategic recommendations.",
    collaborationStyle: "Evidence-first parallel research with synthesis checkpoints.",
    sharedMemoryScope: "org.team.research.shared",
    approvalSensitivity: "LOW",
    successCriteria: [
      "Source map with reliability scoring",
      "Synthesized findings and trends",
      "Decision-ready research brief"
    ],
    toolCategories: ["research", "docs", "analytics"],
    exampleDeliverables: ["Research source map", "Synthesis memo", "Executive brief"],
    roles: [
      roleTemplate({
        roleName: "Research Lead",
        description: "Frames hypotheses and manages research quality thresholds.",
        responsibilities: [
          "Define research questions and hypotheses",
          "Set source reliability expectations",
          "Coordinate synthesis cadence"
        ],
        defaultInitialTasks: [
          "Publish hypothesis map",
          "Set evidence quality rubric"
        ],
        toolCategories: ["research", "docs"],
        collaborationStyle: "Hypothesis-driven check-ins with source transparency.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Research plan", "Evidence quality rubric"]
      }),
      roleTemplate({
        roleName: "Source Discovery Agent",
        description: "Finds and catalogs relevant evidence sources.",
        responsibilities: [
          "Collect primary and secondary sources",
          "Tag source quality and recency",
          "Avoid duplicate source collection"
        ],
        defaultInitialTasks: [
          "Build initial source inventory",
          "Tag source confidence levels"
        ],
        toolCategories: ["research"],
        collaborationStyle: "Structured source registry updates.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Source catalog", "Source confidence tags"]
      }),
      roleTemplate({
        roleName: "Evidence Synthesizer",
        description: "Combines source evidence into concise findings.",
        responsibilities: [
          "Extract consistent insights from evidence",
          "Highlight contradictions and confidence limits",
          "Prepare findings for brief writer"
        ],
        defaultInitialTasks: [
          "Draft cross-source synthesis notes",
          "Flag conflicting evidence and unknowns"
        ],
        toolCategories: ["research", "docs"],
        collaborationStyle: "Clear distinction between facts, inference, and assumptions.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Synthesis summary", "Contradiction register"]
      }),
      roleTemplate({
        roleName: "Trend Analyst",
        description: "Extracts directional signals from data and sources.",
        responsibilities: [
          "Identify trend vectors and leading indicators",
          "Map trend impact by scenario",
          "Share quant-backed trend snapshots"
        ],
        defaultInitialTasks: [
          "Publish trend indicator matrix",
          "Draft scenario impact notes"
        ],
        toolCategories: ["analytics", "research"],
        collaborationStyle: "Data-backed trend narrative with confidence labels.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Trend snapshot", "Scenario impact notes"]
      }),
      roleTemplate({
        roleName: "Brief Writer",
        description: "Converts findings into an executive-ready brief.",
        responsibilities: [
          "Structure findings into clear narrative",
          "Link claims to cited evidence",
          "Document recommendations and open questions"
        ],
        defaultInitialTasks: [
          "Draft executive brief outline",
          "Create recommendations and risk section"
        ],
        toolCategories: ["docs", "content"],
        collaborationStyle: "Decision-focused writing with traceable evidence.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Executive research brief", "Recommendation summary"]
      })
    ]
  },
  product: {
    teamType: "product",
    objective: "Define product direction, delivery priorities, and measurable outcomes.",
    collaborationStyle: "Roadmap-first collaboration with weekly review cadence.",
    sharedMemoryScope: "org.team.product.shared",
    approvalSensitivity: "MEDIUM",
    successCriteria: [
      "Prioritized roadmap with rationale",
      "Requirements and dependency map",
      "Launch-readiness checkpoints"
    ],
    toolCategories: ["docs", "analytics", "project", "research"],
    exampleDeliverables: ["Roadmap draft", "PRD outline", "Dependency register"],
    roles: [
      roleTemplate({
        roleName: "Product Strategist",
        description: "Owns product vision alignment and roadmap framing.",
        responsibilities: [
          "Define product priorities and value thesis",
          "Align roadmap to company goals",
          "Drive tradeoff decisions"
        ],
        defaultInitialTasks: [
          "Draft roadmap themes and constraints",
          "Define north-star metrics"
        ],
        toolCategories: ["analytics", "docs", "research"],
        collaborationStyle: "Decision logs with explicit tradeoffs.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Roadmap themes", "North-star metric sheet"]
      }),
      roleTemplate({
        roleName: "Requirements Analyst",
        description: "Converts strategy into requirements and acceptance criteria.",
        responsibilities: [
          "Write structured requirements and scope boundaries",
          "Maintain acceptance criteria and dependencies",
          "Flag requirement ambiguity early"
        ],
        defaultInitialTasks: [
          "Draft requirement inventory",
          "Publish acceptance criteria checklist"
        ],
        toolCategories: ["docs", "project"],
        collaborationStyle: "Requirement quality gates before handoff.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Requirement backlog", "Acceptance criteria set"]
      }),
      roleTemplate({
        roleName: "User Insight Analyst",
        description: "Captures user behavior and pain-point evidence.",
        responsibilities: [
          "Aggregate user signal and feedback themes",
          "Map pain points to product opportunities",
          "Publish insight-backed recommendations"
        ],
        defaultInitialTasks: [
          "Synthesize user feedback themes",
          "Prioritize user pain points by impact"
        ],
        toolCategories: ["research", "analytics"],
        collaborationStyle: "User-evidence updates linked to roadmap items.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["User insight brief", "Opportunity mapping"]
      }),
      roleTemplate({
        roleName: "Delivery Coordinator",
        description: "Tracks dependencies and delivery readiness.",
        responsibilities: [
          "Maintain delivery timeline and blockers",
          "Coordinate cross-functional dependencies",
          "Publish risk and mitigation status"
        ],
        defaultInitialTasks: [
          "Create delivery dependency map",
          "Publish risk register with owner mapping"
        ],
        toolCategories: ["project", "communication", "docs"],
        collaborationStyle: "Dependency-first execution visibility.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Delivery plan", "Risk/mitigation register"]
      })
    ]
  },
  content: {
    teamType: "content",
    objective: "Produce consistent high-quality content aligned with campaign and brand goals.",
    collaborationStyle: "Editorial workflow with staged draft reviews.",
    sharedMemoryScope: "org.team.content.shared",
    approvalSensitivity: "MEDIUM",
    successCriteria: [
      "Editorial plan with role ownership",
      "Draft pipeline with quality checkpoints",
      "Publish-ready artifact bundle"
    ],
    toolCategories: ["content", "docs", "social", "research"],
    exampleDeliverables: ["Editorial calendar", "Draft set", "Publishing checklist"],
    roles: [
      roleTemplate({
        roleName: "Content Lead",
        description: "Sets editorial direction and standards.",
        responsibilities: [
          "Define editorial strategy and priorities",
          "Set quality and consistency guidelines",
          "Coordinate draft pipeline"
        ],
        defaultInitialTasks: [
          "Draft editorial goals for the cycle",
          "Publish quality standards checklist"
        ],
        toolCategories: ["content", "docs", "research"],
        collaborationStyle: "Editorial decisions documented in Hub.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Editorial strategy memo", "Quality rubric"]
      }),
      roleTemplate({
        roleName: "Copywriter",
        description: "Produces core copy assets across channels.",
        responsibilities: [
          "Draft clear audience-focused copy",
          "Align tone with brand standards",
          "Revise drafts from feedback"
        ],
        defaultInitialTasks: [
          "Draft first-pass content set",
          "Prepare revised copy options"
        ],
        toolCategories: ["content", "docs", "social"],
        collaborationStyle: "Rapid draft-feedback loop.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Copy drafts", "Revision changelog"]
      }),
      roleTemplate({
        roleName: "Content Editor",
        description: "Applies quality, clarity, and consistency checks.",
        responsibilities: [
          "Review drafts for clarity and correctness",
          "Enforce editorial standards",
          "Approve final copy for publish queue"
        ],
        defaultInitialTasks: [
          "Review content drafts for quality issues",
          "Publish editor feedback summary"
        ],
        toolCategories: ["docs", "content"],
        collaborationStyle: "Quality gate sign-off workflow.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Edited drafts", "Editorial feedback notes"]
      }),
      roleTemplate({
        roleName: "Distribution Planner",
        description: "Plans publishing channels and timing.",
        responsibilities: [
          "Map content to channels and schedule",
          "Coordinate publish dependencies",
          "Track distribution readiness"
        ],
        defaultInitialTasks: [
          "Create content distribution schedule",
          "Publish channel readiness checklist"
        ],
        toolCategories: ["social", "communication", "project"],
        collaborationStyle: "Channel plan updates with dependency visibility.",
        approvalSensitivity: "HIGH",
        exampleDeliverables: ["Distribution schedule", "Channel publish checklist"]
      })
    ]
  },
  general: {
    teamType: "general",
    objective: "Assemble a cross-functional execution team for the requested mission.",
    collaborationStyle: "Manager-led execution with explicit handoffs.",
    sharedMemoryScope: "org.team.general.shared",
    approvalSensitivity: "MEDIUM",
    successCriteria: [
      "Mission decomposition with ownership",
      "Status visibility and blocker management",
      "Consolidated delivery summary"
    ],
    toolCategories: ["docs", "communication", "analytics"],
    exampleDeliverables: ["Execution plan", "Status report", "Final summary"],
    roles: [
      roleTemplate({
        roleName: "Team Manager",
        description: "Coordinates execution and dependency flow.",
        responsibilities: [
          "Break mission into scoped tasks",
          "Assign priorities and deadlines",
          "Track blockers and escalation points"
        ],
        defaultInitialTasks: [
          "Create execution map with owners",
          "Publish first dependency checkpoint"
        ],
        toolCategories: ["project", "docs", "communication"],
        collaborationStyle: "Daily sync and dependency updates.",
        approvalSensitivity: "MEDIUM",
        exampleDeliverables: ["Execution map", "Dependency checkpoint"]
      }),
      roleTemplate({
        roleName: "Execution Specialist",
        description: "Delivers scoped work packages with clear outputs.",
        responsibilities: [
          "Execute assigned tasks with context reuse",
          "Publish concise progress and blockers",
          "Return structured deliverables"
        ],
        defaultInitialTasks: [
          "Deliver first execution work package",
          "Publish blocker/next-step status"
        ],
        toolCategories: ["docs", "analytics", "research"],
        collaborationStyle: "Task-focused outputs and concise updates.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Work package output", "Progress update"]
      }),
      roleTemplate({
        roleName: "Operations Analyst",
        description: "Supports planning quality and outcome tracking.",
        responsibilities: [
          "Track execution metrics and quality signals",
          "Identify operational risks",
          "Recommend corrective actions"
        ],
        defaultInitialTasks: [
          "Create operational health snapshot",
          "Publish risk and mitigation notes"
        ],
        toolCategories: ["analytics", "docs"],
        collaborationStyle: "Evidence-backed operational recommendations.",
        approvalSensitivity: "LOW",
        exampleDeliverables: ["Operational snapshot", "Risk notes"]
      })
    ]
  }
};

const TEAM_KEYWORD_MAP: Array<{ keywords: string[]; teamType: SwarmTeamType }> = [
  { keywords: ["marketing", "campaign", "growth", "seo", "social"], teamType: "marketing" },
  { keywords: ["sales", "pipeline", "prospect", "outreach", "crm"], teamType: "sales" },
  { keywords: ["research", "insight", "analysis", "brief"], teamType: "research" },
  { keywords: ["product", "roadmap", "feature", "prd"], teamType: "product" },
  { keywords: ["content", "editorial", "copy", "writing"], teamType: "content" }
];

export function resolveTeamTypeFromText(message: string): SwarmTeamType {
  const lower = message.toLowerCase();
  const matched = TEAM_KEYWORD_MAP.find((entry) =>
    entry.keywords.some((keyword) => lower.includes(keyword))
  );
  return matched?.teamType ?? "general";
}

export function getTeamTemplate(teamType: SwarmTeamType): TeamTemplate {
  return TEAM_TEMPLATE_REGISTRY[teamType];
}

export function buildRolePromptFromTemplate(input: {
  teamGoal: string;
  orgName: string;
  managerName: string;
  role: TeamBlueprintRole;
}) {
  return buildRolePrompt({
    roleName: input.role.roleName,
    teamGoal: input.teamGoal,
    responsibilities: input.role.responsibilities,
    orgName: input.orgName,
    managerName: input.managerName,
    collaborationStyle: input.role.collaborationStyle
  });
}
