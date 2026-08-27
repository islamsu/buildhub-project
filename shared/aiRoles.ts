/**
 * ONE AI ENGINE, SIX EXPERIENCES.
 *
 * Everything the assistant KNOWS is shared - construction knowledge, BuildHub
 * rules, jurisdiction records, retrieval, the marketplace, attachments,
 * security, language. What changes with the role is what gets OFFERED and what
 * an answer EMPHASISES.
 *
 * That split is deliberate and it is the whole design. Six separate assistants
 * would mean six corpora to keep in sync, six places for a BuildHub rule to
 * drift, and six security surfaces. A contractor asking a homeowner's question
 * must get the homeowner's answer quality, not a worse one - the role is a
 * DEFAULT stance, never a restriction on what may be asked.
 *
 * The role itself is read from the authenticated session server-side. It is
 * never a request field, so there is nothing for a client to set.
 */

export const BUILDHUB_ROLES = [
  'homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager',
] as const;

export type BuildHubRole = (typeof BUILDHUB_ROLES)[number];

export const isBuildHubRole = (value: unknown): value is BuildHubRole =>
  typeof value === 'string' && (BUILDHUB_ROLES as readonly string[]).includes(value);

/** A tool card. `icon` is a name the client maps to a component, not a component. */
export type AiTool = {
  id: string;
  labelKey: string;
  promptKey: string;
  icon: string;
};

/**
 * A BuildHub action offered alongside an answer.
 *
 * `href` MUST be a route that exists in client/src/App.tsx. A button that goes
 * nowhere is worse than no button: it teaches people the assistant's
 * suggestions are decorative.
 */
export type AiAction = {
  id: string;
  labelKey: string;
  href: string;
};

export type RoleExperience = {
  role: BuildHubRole;
  titleKey: string;
  subtitleKey: string;
  tools: AiTool[];
  actions: AiAction[];
  /**
   * How an answer for this role should be pitched. Sent to the model as a
   * DEFAULT STANCE, explicitly not a restriction - the prompt says so, because
   * a model told "this user is a homeowner" will otherwise refuse to go
   * technical when a homeowner asks a technical question.
   */
  emphasis: string;
};

const tool = (id: string, icon: string): AiTool => ({
  id,
  icon,
  labelKey: `ai.tool.${id}`,
  promptKey: `ai.tool.${id}.prompt`,
});

const action = (id: string, href: string): AiAction => ({
  id,
  href,
  labelKey: `ai.action.${id}`,
});

/** Routes that exist. Referenced by name so a typo is a compile error. */
export const ROUTES = {
  rfq: '/rfq',
  vendors: '/marketplace/vendors',
  designers: '/marketplace/designers',
  products: '/marketplace/products',
  finishing: '/marketplace/finishing',
  marketplace: '/marketplace',
  provider: '/provider',
  dashboard: '/dashboard',
  messages: '/messages',
} as const;

export const ROLE_EXPERIENCES: Record<BuildHubRole, RoleExperience> = {
  homeowner: {
    role: 'homeowner',
    titleKey: 'ai.role.homeowner.title',
    subtitleKey: 'ai.role.homeowner.subtitle',
    tools: [
      tool('projectPlanner', 'ClipboardList'),
      tool('costEstimator', 'Calculator'),
      tool('findDesigner', 'Palette'),
      tool('findContractor', 'HardHat'),
      tool('materialsAdvisor', 'Lightbulb'),
      tool('quoteAnalyzer', 'FileSearch'),
      tool('documentAnalyzer', 'FileText'),
      tool('riskAdvisor', 'AlertTriangle'),
    ],
    actions: [
      action('createRfq', ROUTES.rfq),
      action('findDesigner', ROUTES.designers),
      action('findContractor', ROUTES.vendors),
      action('browseProducts', ROUTES.products),
    ],
    emphasis: `They are a HOMEOWNER or CUSTOMER planning work on their own property.
Explain in decision-friendly terms: what the options are, what each would mean
for cost, time and disruption, and what to ask a professional. Define technical
terms the first time you use them. Where a choice is genuinely a judgement call,
say what would tip it either way rather than making it for them.`,
  },

  contractor: {
    role: 'contractor',
    titleKey: 'ai.role.contractor.title',
    subtitleKey: 'ai.role.contractor.subtitle',
    tools: [
      tool('findRfqs', 'Search'),
      tool('rfqAnalyzer', 'FileSearch'),
      tool('boqAnalyzer', 'Layers'),
      tool('costEstimator', 'Calculator'),
      tool('quoteBuilder', 'FileSpreadsheet'),
      tool('procurementAssistant', 'ShoppingCart'),
      tool('projectPlanner', 'ClipboardList'),
      tool('riskDetector', 'AlertTriangle'),
    ],
    actions: [
      action('viewRfqs', ROUTES.rfq),
      action('findSuppliers', ROUTES.vendors),
      action('myWork', ROUTES.provider),
      action('messages', ROUTES.messages),
    ],
    emphasis: `They are a CONTRACTOR who will execute the work and carry the
commercial risk of getting it wrong. Emphasise execution: quantities, sequence,
labour and plant, buildability, procurement lead times, and where a price is
likely to be exposed. Be specific about what a scope does NOT say, because
that is where a contractor loses money.`,
  },

  engineer: {
    role: 'engineer',
    titleKey: 'ai.role.engineer.title',
    subtitleKey: 'ai.role.engineer.subtitle',
    tools: [
      tool('technicalAdvisor', 'Cpu'),
      tool('documentAnalyzer', 'FileText'),
      tool('specAnalyzer', 'FileSearch'),
      tool('codeResearch', 'BookOpen'),
      tool('qaqcAssistant', 'ClipboardCheck'),
      tool('materialTechnical', 'FlaskConical'),
      tool('riskDetector', 'AlertTriangle'),
      tool('quantityChecker', 'Layers'),
    ],
    actions: [
      action('findSuppliers', ROUTES.vendors),
      action('createRfq', ROUTES.rfq),
      action('browseProducts', ROUTES.products),
      action('myWork', ROUTES.provider),
    ],
    emphasis: `They are an ENGINEER. Use correct technical terminology without
unpacking it, and be precise about assumptions, load cases, exposure conditions,
tolerances and test regimes. Name the standard or code that governs a
requirement rather than stating the requirement - and where the governing
edition is jurisdictional, say so instead of quoting a number.`,
  },

  architect: {
    role: 'architect',
    titleKey: 'ai.role.architect.title',
    subtitleKey: 'ai.role.architect.subtitle',
    tools: [
      tool('designAdvisor', 'Palette'),
      tool('materialsAdvisor', 'Lightbulb'),
      tool('specAssistant', 'FileSpreadsheet'),
      tool('drawingAnalyzer', 'FileText'),
      tool('briefAnalyzer', 'ClipboardList'),
      tool('codeResearch', 'BookOpen'),
      tool('sustainabilityAdvisor', 'Leaf'),
      tool('procurementAdvisor', 'ShoppingCart'),
    ],
    actions: [
      action('findSuppliers', ROUTES.vendors),
      action('browseProducts', ROUTES.products),
      action('createRfq', ROUTES.rfq),
      action('findFinishing', ROUTES.finishing),
    ],
    emphasis: `They are an ARCHITECT. Emphasise design intent, spatial and
material consequences, specification wording, buildability of the detail, and
how a choice reads to the client and to the approving authority. Treat
performance and appearance as one problem, and be explicit where a specification
would need a performance requirement rather than a product name.`,
  },

  supplier: {
    role: 'supplier',
    titleKey: 'ai.role.supplier.title',
    subtitleKey: 'ai.role.supplier.subtitle',
    tools: [
      tool('findOpportunities', 'Search'),
      tool('rfqMatcher', 'FileSearch'),
      tool('productMatcher', 'Package'),
      tool('requirementAnalyzer', 'ClipboardList'),
      tool('quoteAssistant', 'FileSpreadsheet'),
      tool('productDescription', 'PenLine'),
      tool('substitutionAdvisor', 'Repeat'),
      tool('demandInsights', 'TrendingUp'),
    ],
    actions: [
      action('viewRfqs', ROUTES.rfq),
      action('myProducts', ROUTES.provider),
      action('browseProducts', ROUTES.products),
      action('messages', ROUTES.messages),
    ],
    emphasis: `They are a SUPPLIER selling materials or products. Emphasise
product fit against the stated requirement, what evidence a buyer will ask for
(certification, test data, compliance with the specified standard), lead time
and availability, and whether a substitution is technically defensible. Be
direct about where a product does NOT meet a requirement - a supplier who finds
that out at inspection loses more than the order.`,
  },

  project_manager: {
    role: 'project_manager',
    titleKey: 'ai.role.project_manager.title',
    subtitleKey: 'ai.role.project_manager.subtitle',
    tools: [
      tool('projectControl', 'GanttChart'),
      tool('scheduleAssistant', 'CalendarClock'),
      tool('riskManager', 'AlertTriangle'),
      tool('costController', 'Calculator'),
      tool('procurementAssistant', 'ShoppingCart'),
      tool('variationAnalyzer', 'FileSearch'),
      tool('progressAnalyzer', 'TrendingUp'),
      tool('reportAssistant', 'FileText'),
    ],
    actions: [
      action('myWork', ROUTES.provider),
      action('createRfq', ROUTES.rfq),
      action('findContractor', ROUTES.vendors),
      action('messages', ROUTES.messages),
    ],
    emphasis: `They are a PROJECT MANAGER accountable for delivery. Emphasise
schedule impact and the critical path, cost control and forecast, procurement
lead times, interface and coordination risk, and what needs a decision now
versus what can wait. When something is a risk, say what would trigger it and
what the mitigation costs.`,
  },
};

/**
 * The experience for a role, with a safe fallback.
 *
 * An unknown role - a new enum value, an admin, a null - gets the HOMEOWNER
 * experience rather than an error or an empty page. Falling back to the least
 * specialised experience is the failure mode that still works: every tool it
 * offers is meaningful to any construction user.
 */
export function experienceFor(role: string | null | undefined): RoleExperience {
  return isBuildHubRole(role) ? ROLE_EXPERIENCES[role] : ROLE_EXPERIENCES.homeowner;
}

/** Every localization key the role layer needs, for a completeness test. */
export function allRoleKeys(): string[] {
  const keys: string[] = [];
  for (const experience of Object.values(ROLE_EXPERIENCES)) {
    keys.push(experience.titleKey, experience.subtitleKey);
    for (const item of experience.tools) keys.push(item.labelKey, item.promptKey);
    for (const item of experience.actions) keys.push(item.labelKey);
  }
  return keys.filter((key, index, all) => all.indexOf(key) === index).sort();
}
