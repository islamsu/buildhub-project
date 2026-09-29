/**
 * ── A CLICK GIVES CONTEXT. IT DOES NOT ASK A QUESTION. ──────────────────
 *
 * THE DEFECT THIS EXISTS FOR. Clicking a suggested prompt called
 * `onSendMessage(prompt)` and clicking a tool card called
 * `handleSend(t(mode.promptKey))`. Both appended text the PRODUCT wrote to the
 * transcript as `role: 'user'` and submitted it in the same tick. The person
 * never typed it, never read it, and could not edit it - and afterwards the
 * conversation contained a question attributed to them, indistinguishable from
 * one they had actually asked. Every later answer was then grounded on it.
 *
 * That is not a UX nit. A transcript is the record of what someone asked, and a
 * system that writes into it on their behalf has made the record untrue.
 *
 * So: a click SELECTS A SUBJECT. The assistant offers suggestions and waits.
 * Choosing one fills the composer - editable, focused - and sending is a
 * separate, deliberate act. `kind: 'navigate'` suggestions ask nothing at all;
 * they go somewhere.
 *
 * ── AND THE SUGGESTIONS WERE THE SAME SIX STRINGS FOR EVERYONE ──────────
 *
 * `ai.suggestion.1` … `ai.suggestion.6`: fixed, role-blind, stage-blind,
 * object-blind. A contractor looking at a published request they could bid on
 * was offered "Estimate the cost of finishing a 150m² apartment in Cairo".
 *
 * Suggestions here are DERIVED, from the object, its subtype, the viewer's
 * session role, the workflow stage, and what the viewer is permitted to see.
 * Change any one of those and the list changes - which is the property the
 * tests assert, because a "context-aware" engine that returns the same list for
 * every context is the old defect wearing a new name.
 *
 * ── THE PERMISSION RULE THAT MATTERS MOST ───────────────────────────────
 *
 * `SuggestionContext` is built by the SERVER from the viewer's PERMITTED
 * PROJECTION of the object - the same projection their own read returns. A
 * field being present on the server row is not a reason to put it in front of
 * the model. That is why this module takes a small, deliberately poor context
 * rather than an entity: it cannot leak what it was never given.
 */

import { isUnknown, type HelpableBriefField } from './finishing';

/** The kinds of object a click can select. */
export const SUGGESTION_SUBJECTS = [
  'service', 'category', 'request', 'quotation', 'provider', 'boq_item', 'project', 'general',
] as const;
export type SuggestionSubject = (typeof SUGGESTION_SUBJECTS)[number];

/**
 * The viewer's relationship to the selected object, as the server resolved it.
 *
 * NOT the account's global role. A contractor IS the requester of the request
 * they raised, and must be offered the requester's actions on it. Asking "what
 * is this person to THIS object" is the question that makes the suggestions
 * correct; asking "what is this person" is how a contractor gets offered
 * "prepare a quotation" for their own request.
 */
export const VIEWER_RELATIONS = ['requester', 'provider', 'member', 'observer'] as const;
export type ViewerRelation = (typeof VIEWER_RELATIONS)[number];

/**
 * What the suggestion engine is allowed to know.
 *
 * Every field is something the viewer may already see. There is no budget, no
 * owner identity, no contact detail and no rival's price, because a suggestion
 * has no use for them and a prompt built from them would carry them into the
 * model's context.
 */
export type SuggestionContext = {
  subject: SuggestionSubject;
  /** For a request/quotation/provider/project: the id the viewer selected. */
  subjectId?: number | null;
  /** The object's own subtype - an RFQ category, a service's category. */
  subtype?: string | null;
  /** Session role. Never a request field. */
  role: string | null;
  relation: ViewerRelation;
  /** The object's canonical status, verbatim. */
  status?: string | null;
  /** How many quotations this request has, as the viewer is permitted to count. */
  quotationCount?: number;
  /** Whether the selected request is a finishing request. */
  isFinishing?: boolean;
  /** Brief fields the requester explicitly said they do not know. */
  unknownFields?: readonly HelpableBriefField[];
  /** Whether the viewer may actually respond to this request right now. */
  canRespond?: boolean;
  /** The pricing method the request asked for, if it stated one. */
  pricingPreference?: string | null;
};

/**
 * One offer.
 *
 * `kind` is the whole contract:
 *
 *   'prompt'    fills the composer with `promptEn`/`promptAr`. It is NOT sent.
 *   'navigate'  goes to `href`. It asks nothing.
 *
 * There is no third kind, and in particular there is no kind that submits.
 */
export type Suggestion = {
  id: string;
  kind: 'prompt' | 'navigate';
  labelEn: string;
  labelAr: string;
  promptEn?: string;
  promptAr?: string;
  href?: string;
};

const prompt = (id: string, labelEn: string, labelAr: string, promptEn: string, promptAr: string): Suggestion =>
  ({ id, kind: 'prompt', labelEn, labelAr, promptEn, promptAr });

const navigate = (id: string, labelEn: string, labelAr: string, href: string): Suggestion =>
  ({ id, kind: 'navigate', labelEn, labelAr, href });

/** Help offers for exactly the fields the requester said they did not know. */
const FIELD_HELP: Readonly<Record<HelpableBriefField, Suggestion>> = {
  kind: prompt('help-kind', 'Which kind of finishing do I need?', 'أي نوع تشطيب أحتاج؟',
    'I am not sure whether I need full finishing, partial finishing or a renovation. Explain the difference and help me choose.',
    'لست متأكداً إن كنت أحتاج تشطيب كامل أم جزئي أم تجديد. اشرح الفرق وساعدني في الاختيار.'),
  propertyType: prompt('help-property', 'Help me describe the property', 'ساعدني في وصف العقار',
    'Help me describe my property type for a finishing request.',
    'ساعدني في وصف نوع عقاري في طلب التشطيب.'),
  currentCondition: prompt('help-condition', 'What condition is my unit in?', 'ما حالة الوحدة لدي؟',
    'Explain what core and shell, semi-finished and finished mean, so I can say which one my unit is.',
    'اشرح معنى على المحارة ونصف تشطيب ومُشطّب حتى أحدد حالة وحدتي.'),
  areaSqm: prompt('help-area', 'How do I work out the area?', 'كيف أحسب المساحة؟',
    'I do not know the area of my unit in square metres. How can I work it out or estimate it?',
    'لا أعرف مساحة وحدتي بالمتر المربع. كيف أحسبها أو أقدّرها؟'),
  level: prompt('help-level', 'Help me choose a finishing level', 'ساعدني في تحديد مستوى التشطيب',
    'Explain the finishing levels and help me choose the one that fits what I want.',
    'اشرح مستويات التشطيب وساعدني في اختيار المستوى المناسب لي.'),
  materialPreferences: prompt('help-materials', 'Explain the material options', 'شرح خيارات التشطيب',
    'Explain the usual material options for finishing work and what changes between them.',
    'اشرح خيارات الخامات المعتادة في أعمال التشطيب والفرق بينها.'),
  siteConstraints: prompt('help-constraints', 'What site constraints matter?', 'ما القيود المهمة في الموقع؟',
    'What site constraints should I tell a finishing contractor about?',
    'ما القيود التي يجب أن أخبر بها مقاول التشطيب عن الموقع؟'),
};

/**
 * The suggestions for a context.
 *
 * Ordered most-useful-first for this exact situation, because the first two are
 * the only ones most people read.
 */
export function suggestionsFor(context: SuggestionContext): Suggestion[] {
  const out: Suggestion[] = [];
  const finishing = context.isFinishing === true;

  switch (context.subject) {
    // ── A SERVICE OR A CATEGORY: nothing has been requested yet ──────────
    case 'service':
    case 'category': {
      if (context.relation === 'provider') {
        // A provider looking at a category is looking at a market they sell
        // into, not something they want to buy.
        out.push(prompt('cat-demand', 'What are buyers asking for here?', 'ما الذي يطلبه المشترون هنا؟',
          `What do buyers usually ask for in ${context.subtype ?? 'this category'}, and what should a quotation cover?`,
          `ما الذي يطلبه المشترون عادةً في ${context.subtype ?? 'هذا التصنيف'}، وما الذي يجب أن يغطيه عرض السعر؟`));
        out.push(prompt('cat-package', 'Build a package for this', 'إنشاء باقة',
          `Help me design a finishing package for ${context.subtype ?? 'this category'}: what to include, what to exclude and how to price it.`,
          `ساعدني في تصميم باقة تشطيب لـ${context.subtype ?? 'هذا التصنيف'}: ما يُشمل وما يُستثنى وكيف تُسعّر.`));
        out.push(navigate('cat-listing', 'Manage my listings', 'إدارة عروضي', '/settings'));
        break;
      }
      // The homeowner path. These are the four the spec names.
      if (finishing) {
        out.push(navigate('fin-create', 'Create a finishing request', 'إنشاء طلب تشطيب', '/rfq?finishing=1'));
        out.push(prompt('fin-level', 'Help me choose a finishing level', 'ساعدني في تحديد مستوى التشطيب',
          'Help me decide which finishing level suits what I want and what I can spend.',
          'ساعدني في تحديد مستوى التشطيب المناسب لما أريده ولميزانيتي.'));
        out.push(prompt('fin-budget', 'Estimate the budget', 'تقدير الميزانية',
          'Help me estimate a realistic budget range for finishing my unit, and tell me what the estimate depends on.',
          'ساعدني في تقدير نطاق ميزانية واقعي لتشطيب وحدتي، ووضّح على ماذا يعتمد التقدير.'));
        out.push(prompt('fin-options', 'Explain the finishing options', 'شرح خيارات التشطيب',
          'Explain the main finishing options and what changes between them.',
          'اشرح خيارات التشطيب الرئيسية والفرق بينها.'));
        break;
      }
      out.push(navigate('cat-request', 'Request quotes', 'اطلب عروض أسعار', '/rfq'));
      out.push(prompt('cat-scope', 'What should I ask for?', 'ماذا يجب أن أطلب؟',
        `What should I include in a request for ${context.subtype ?? 'this work'} so contractors can price it properly?`,
        `ماذا يجب أن أضع في طلب ${context.subtype ?? 'هذا العمل'} حتى يتمكن المقاولون من تسعيره بدقة؟`));
      out.push(prompt('cat-cost', 'What does this usually cost?', 'كم تكلفة هذا عادةً؟',
        `What does ${context.subtype ?? 'this work'} usually cost, and what makes the price vary?`,
        `كم تكلفة ${context.subtype ?? 'هذا العمل'} عادةً، وما الذي يجعل السعر يتغيّر؟`));
      break;
    }

    // ── A REQUEST: the suggestions turn on WHO is looking and WHEN ───────
    case 'request': {
      const id = context.subjectId ?? 0;

      if (context.relation === 'provider') {
        if (context.canRespond === false) {
          out.push(prompt('req-eligibility', 'Can I quote on this?', 'هل يمكنني تقديم عرض؟',
            'What do I need to do before I can submit a quotation on this request?',
            'ماذا أحتاج قبل أن أتمكن من تقديم عرض سعر على هذا الطلب؟'));
          break;
        }
        // The five the spec names for a contractor on a published request.
        out.push(prompt('req-prepare', 'Prepare a quotation', 'إعداد عرض سعر',
          'Help me prepare a quotation for this request: what it should cover and how to structure it.',
          'ساعدني في إعداد عرض سعر لهذا الطلب: ما الذي يجب أن يغطيه وكيف أنظّمه.'));
        out.push(prompt('req-gaps', 'What information is missing?', 'تحديد المعلومات الناقصة',
          'What information is missing from this request that I would need before I could price it?',
          'ما المعلومات الناقصة في هذا الطلب والتي أحتاجها قبل أن أستطيع تسعيره؟'));
        out.push(prompt('req-clarify', 'Draft a clarification question', 'طلب توضيح',
          'Draft a short, professional clarification question to send to this customer.',
          'اكتب سؤال توضيح قصيراً ومهنياً لإرساله إلى هذا العميل.'));
        out.push(prompt('req-price', 'Work out the price', 'حساب السعر',
          `Walk me through pricing this work${context.pricingPreference ? ` using the ${context.pricingPreference} method the customer asked for` : ''}, and what I must not leave out.`,
          `اشرح لي كيفية تسعير هذا العمل${context.pricingPreference ? ' بطريقة التسعير التي طلبها العميل' : ''}، وما الذي يجب ألا أغفله.`));
        if (finishing) {
          out.push(prompt('req-package', 'Build a package', 'إنشاء باقة',
            'Help me put together a finishing package for this request: scope, inclusions, exclusions and how to price it.',
            'ساعدني في تكوين باقة تشطيب لهذا الطلب: النطاق والمشمولات والاستثناءات وطريقة التسعير.'));
        }
        if (id > 0) out.push(navigate('req-respond', 'Open the request', 'افتح الطلب', `/rfq/${id}`));
        break;
      }

      // ── THE REQUESTER. The stage decides everything. ──────────────────
      if ((context.quotationCount ?? 0) > 0) {
        // Quotations exist: the three the spec names.
        out.push(prompt('req-compare', 'Compare the quotations', 'قارن العروض',
          'Compare the quotations I have received: what differs in scope, in price and in what each one leaves out.',
          'قارن العروض التي وصلتني: ما الفرق في النطاق وفي السعر وفي ما يستثنيه كل عرض.'));
        out.push(prompt('req-excluded', 'What is not included?', 'ما البنود غير المشمولة؟',
          'Which items are excluded from these quotations, or not mentioned at all?',
          'ما البنود المستثناة من هذه العروض أو غير المذكورة فيها أصلاً؟'));
        out.push(prompt('req-whydiff', 'Explain the price difference', 'اشرح فرق الأسعار',
          'Explain why these quotations differ in price, and whether they are pricing the same scope.',
          'اشرح لماذا تختلف أسعار هذه العروض، وهل تسعّر النطاق نفسه.'));
        if (id > 0) out.push(navigate('req-open', 'Open the comparison', 'افتح المقارنة', `/rfq/${id}`));
        break;
      }

      // No quotations yet: help them make the request answerable.
      for (const field of context.unknownFields ?? []) {
        const help = FIELD_HELP[field];
        if (help) out.push(help);
      }
      out.push(prompt('req-quality', 'Will contractors be able to price this?', 'هل يستطيع المقاولون تسعير هذا؟',
        'Look at my request and tell me what a contractor would still need to know before they could price it.',
        'راجع طلبي وأخبرني بما سيظل المقاول بحاجة لمعرفته قبل أن يستطيع تسعيره.'));
      out.push(prompt('req-expect', 'What should I expect back?', 'ماذا أتوقع أن يصلني؟',
        'What should I expect a good quotation for this work to contain?',
        'ما الذي يجب أن يحتويه عرض السعر الجيد لهذا العمل؟'));
      break;
    }

    // ── A QUOTATION ──────────────────────────────────────────────────────
    case 'quotation': {
      if (context.relation === 'provider') {
        out.push(prompt('quo-review', 'Review my quotation', 'راجع عرضي',
          'Review my quotation and tell me what a customer would find unclear or missing.',
          'راجع عرض السعر الخاص بي وأخبرني بما قد يجده العميل غير واضح أو ناقصاً.'));
        out.push(prompt('quo-cheaper', 'Where could this be cheaper?', 'أين يمكن تخفيض السعر؟',
          'Where could this quotation be cheaper without cutting scope I should be keeping?',
          'أين يمكن تخفيض سعر هذا العرض دون التضحية بنطاق يجب أن أحافظ عليه؟'));
        break;
      }
      out.push(prompt('quo-explain', 'Explain this quotation', 'اشرح هذا العرض',
        'Explain this quotation to me in plain language: how the price was worked out and what it covers.',
        'اشرح لي هذا العرض بلغة بسيطة: كيف حُسب السعر وما الذي يغطيه.'));
      out.push(prompt('quo-excluded', 'What is excluded?', 'ما البنود غير المشمولة؟',
        'What does this quotation exclude, and what has it not mentioned either way?',
        'ما الذي يستثنيه هذا العرض، وما الذي لم يذكره أصلاً؟'));
      out.push(prompt('quo-ask', 'What should I ask before accepting?', 'ماذا أسأل قبل القبول؟',
        'What should I ask this contractor before I accept this quotation?',
        'ماذا يجب أن أسأل هذا المقاول قبل أن أقبل هذا العرض؟'));
      break;
    }

    // ── A PROVIDER ───────────────────────────────────────────────────────
    case 'provider': {
      const id = context.subjectId ?? 0;
      out.push(prompt('prov-fit', 'Is this provider a fit?', 'هل يناسبني هذا المورّد؟',
        'What should I look at on this provider to judge whether they suit my work?',
        'ما الذي يجب أن أنظر إليه في هذا المورّد لأحكم إن كان يناسب عملي؟'));
      out.push(prompt('prov-ask', 'What should I ask them?', 'ماذا أسألهم؟',
        'What should I ask this provider before inviting them to quote?',
        'ماذا يجب أن أسأل هذا المورّد قبل دعوته لتقديم عرض؟'));
      if (id > 0) out.push(navigate('prov-open', 'Open the storefront', 'افتح صفحة المورّد', `/vendor/${id}`));
      break;
    }

    // ── A BOQ LINE ───────────────────────────────────────────────────────
    case 'boq_item': {
      out.push(prompt('boq-explain', 'Explain this line', 'اشرح هذا البند',
        `Explain what this line item covers${context.subtype ? ` (${context.subtype})` : ''} and what a fair rate depends on.`,
        `اشرح ما الذي يغطيه هذا البند${context.subtype ? ` (${context.subtype})` : ''} وعلى ماذا يعتمد السعر العادل.`));
      out.push(prompt('boq-quantity', 'Check this quantity', 'راجع هذه الكمية',
        'How would I check whether this quantity is reasonable for the work described?',
        'كيف أتحقق من أن هذه الكمية معقولة للعمل الموصوف؟'));
      break;
    }

    // ── A PROJECT ────────────────────────────────────────────────────────
    case 'project': {
      const id = context.subjectId ?? 0;
      out.push(prompt('proj-next', 'What should happen next?', 'ما الخطوة التالية؟',
        'Based on where this project has got to, what should happen next?',
        'بناءً على ما وصل إليه هذا المشروع، ما الخطوة التالية؟'));
      out.push(prompt('proj-risks', 'What should I watch for?', 'ما الذي يجب أن أنتبه له؟',
        'What are the usual risks at this stage of a project like this one?',
        'ما المخاطر المعتادة في هذه المرحلة من مشروع كهذا؟'));
      if (id > 0) out.push(navigate('proj-open', 'Open the project', 'افتح المشروع', `/projects/${id}`));
      break;
    }

    // ── NOTHING SELECTED ─────────────────────────────────────────────────
    case 'general':
    default: {
      if (context.relation === 'provider') {
        out.push(prompt('gen-quote', 'Help me price a job', 'ساعدني في تسعير عمل',
          'Help me price a job: what to ask the customer and what to include.',
          'ساعدني في تسعير عمل: ماذا أسأل العميل وما الذي أضمّنه.'));
        out.push(navigate('gen-leads', 'See my opportunities', 'اعرض الفرص المتاحة', '/enquiries'));
        break;
      }
      out.push(prompt('gen-start', 'How do I start?', 'كيف أبدأ؟',
        'I am planning finishing work and do not know where to start. Walk me through it.',
        'أخطط لأعمال تشطيب ولا أعرف من أين أبدأ. اشرح لي الخطوات.'));
      out.push(navigate('gen-request', 'Request quotes', 'اطلب عروض أسعار', '/rfq'));
      break;
    }
  }

  return out;
}

/**
 * A guard, stated as code because it is the whole point of the module.
 *
 * Nothing here may carry a flag, a field or a convention that means "send this
 * automatically". A suggestion is offered; a person sends. If a future edit
 * wants an auto-submitting suggestion it has to delete this function and
 * explain itself to the test that calls it.
 */
export function isAutoSubmittable(_suggestion: Suggestion): false {
  return false;
}

/**
 * The finishing-brief unknowns as the suggestion engine wants them.
 *
 * Re-exported through here so a caller building a context does not have to
 * import the finishing module's internals, and so the coupling is one-way.
 */
export function helpableUnknowns(
  brief: Record<string, unknown> | null | undefined,
  fields: readonly HelpableBriefField[],
): HelpableBriefField[] {
  if (!brief) return [];
  return fields.filter(field => isUnknown(brief[field]));
}
