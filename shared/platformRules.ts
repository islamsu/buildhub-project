/**
 * BuildHub's product rules, stated once, in the language the assistant may use.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT IS NOT
 *
 * It is NOT a knowledge base someone wrote from memory, and it must never
 * become one. Every rule below is a restatement of behaviour that some other
 * file ENFORCES, and each carries the `enforcedBy` path that enforces it.
 * server/buildhubKnowledge.test.ts reads those paths and fails if the
 * enforcing code stops containing the thing the rule claims - so a rule cannot
 * quietly drift away from the product, and a rule cannot be invented here
 * without something real to point at.
 *
 * Numbers are deliberately ABSENT. Prices, allowances, document lists and
 * limits are derived at runtime from shared/billing.ts and
 * shared/compliance.ts - the same constants the application enforces - so
 * changing a price changes what the assistant says without anyone editing a
 * prompt. Only the rules that live as CODE PATHS rather than as constants are
 * written out here.
 *
 * If BuildHub does not have a rule about something, there is no entry for it.
 * Silence here is what makes the assistant say "BuildHub does not specify
 * that" instead of inventing an answer.
 */

export type PlatformRule = {
  /** Stable id, used by tests and by the coverage list. */
  readonly id: string;
  readonly topic: string;
  readonly en: string;
  readonly ar: string;
  /** The file that actually enforces this. Asserted by test. */
  readonly enforcedBy: string;
  /** A literal that must still appear in `enforcedBy`, or the rule has drifted. */
  readonly enforcementAnchor: string;
};

export const PLATFORM_RULES: readonly PlatformRule[] = [
  {
    id: 'rfq.post.free',
    topic: 'RFQ',
    en: 'Posting a request for quotation (RFQ) on BuildHub is free for the customer. BuildHub does not charge a customer to submit an RFQ. Charging on BuildHub applies to vendor subscriptions, not to posting requests.',
    ar: 'نشر طلب عرض سعر (RFQ) على BuildHub مجاني للعميل. لا تفرض BuildHub رسومًا على العميل مقابل تقديم طلب عرض سعر. الاشتراكات المدفوعة في BuildHub تخص المورّدين، وليست مقابل نشر الطلبات.',
    enforcedBy: 'server/routers.ts',
    enforcementAnchor: 'create: protectedProcedure',
  },
  {
    id: 'rfq.quote.approved_only',
    topic: 'RFQ',
    en: 'Not every vendor may quote. Submitting a quotation requires an APPROVED provider account: the vendor must hold a provider role and have completed compliance approval. Unapproved or pending accounts are refused.',
    ar: 'لا يستطيع كل مورّد تقديم عرض سعر. تقديم عرض السعر يتطلب حساب مورّد معتمَد: يجب أن يكون للمورّد دور مزوّد خدمة وأن يكون قد أكمل الموافقة على مستندات الامتثال. الحسابات غير المعتمدة أو قيد المراجعة تُرفض.',
    enforcedBy: 'server/routers.ts',
    enforcementAnchor: 'submitQuotation: approvedProviderProcedure',
  },
  {
    id: 'rfq.enquiry.credit',
    topic: 'RFQ',
    en: 'Opening an RFQ\'s full detail as a qualified enquiry consumes one qualified-enquiry credit from the vendor\'s monthly allowance, the first time that vendor opens that RFQ. Re-opening the same RFQ does not consume another credit. A vendor may only open an RFQ that matches a service category they have declared.',
    ar: 'فتح التفاصيل الكاملة لطلب عرض السعر كاستفسار مؤهَّل يستهلك رصيدًا واحدًا من حصة المورّد الشهرية، وذلك في أول مرة يفتح فيها ذلك المورّد ذلك الطلب. إعادة فتح الطلب نفسه لا تستهلك رصيدًا آخر. ولا يمكن للمورّد فتح طلب إلا إذا كان مطابقًا لفئة خدمة أعلنها.',
    enforcedBy: 'server/routers.ts',
    enforcementAnchor: 'openQualifiedEnquiry',
  },
  {
    id: 'rfq.feed.visibility',
    topic: 'RFQ',
    en: 'The browsable RFQ feed shows each request\'s title, description and budget to signed-in users. Requester file attachments - drawings, bills of quantities, site photos - are NOT included in the feed; they reach the requester\'s own listing only. This is a deliberate, owner-approved decision.',
    ar: 'تعرض قائمة طلبات عروض الأسعار القابلة للتصفح عنوان كل طلب ووصفه وميزانيته للمستخدمين المسجّلين. أما المرفقات التي يرفعها صاحب الطلب - الرسومات وجداول الكميات وصور الموقع - فهي غير مضمّنة في القائمة، ولا تظهر إلا في قائمة صاحب الطلب نفسه. هذا قرار مقصود ومعتمَد.',
    enforcedBy: 'server/routers.ts',
    enforcementAnchor: 'Lead-directory listing only',
  },
  {
    id: 'vendor.approval.documents',
    topic: 'Vendor onboarding',
    en: 'A vendor cannot become approved without submitting the required compliance documents for their role. The required set differs by role and is listed in this briefing. Documents are reviewed by BuildHub compliance staff; an account stays unapproved until that review approves it.',
    ar: 'لا يمكن للمورّد أن يصبح معتمَدًا دون تقديم مستندات الامتثال المطلوبة لدوره. المجموعة المطلوبة تختلف حسب الدور وهي مذكورة في هذا الملخص. تراجع المستندات إدارة الامتثال في BuildHub، ويظل الحساب غير معتمَد حتى تعتمده تلك المراجعة.',
    enforcedBy: 'shared/compliance.ts',
    enforcementAnchor: 'COMPLIANCE_REQUIREMENTS',
  },
  {
    id: 'vendor.ranking.not_for_sale',
    topic: 'Marketplace',
    en: 'A paid plan does NOT buy a higher position in the organic vendor directory. Featured placement is a separate, clearly labelled sponsored strip; featured vendors also still appear in the organic list in their organic position, with the same reputation data from the same source.',
    ar: 'الاشتراك المدفوع لا يشتري ترتيبًا أعلى في دليل المورّدين الطبيعي. الظهور المميّز هو شريط إعلاني منفصل وموسوم بوضوح؛ والمورّدون المميّزون يظهرون أيضًا في القائمة الطبيعية في مواضعهم الطبيعية، وبالبيانات التقييمية نفسها ومن المصدر نفسه.',
    enforcedBy: 'server/vendorDirectory.ts',
    enforcementAnchor: 'listFeaturedVendors',
  },
  {
    id: 'billing.no_self_upgrade',
    topic: 'Billing',
    en: 'A vendor cannot change their own plan through the application. Plan changes follow verified payment events; there is no vendor-callable endpoint that sets a plan, price or subscription status.',
    ar: 'لا يستطيع المورّد تغيير خطته بنفسه من خلال التطبيق. تغييرات الخطة تتم بناءً على أحداث دفع موثّقة؛ ولا يوجد أي نقطة نهاية يستدعيها المورّد لتعيين خطة أو سعر أو حالة اشتراك.',
    enforcedBy: 'server/routers.ts',
    enforcementAnchor: 'READ-ONLY by design',
  },
] as const;

export const PLATFORM_RULE_TOPICS: readonly string[] =
  PLATFORM_RULES.map(rule => rule.topic).filter((topic, i, all) => all.indexOf(topic) === i);
