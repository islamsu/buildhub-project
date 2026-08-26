import type { KnowledgeDocument } from '@shared/knowledgeTaxonomy';

/**
 * The starter construction corpus.
 *
 * SCOPE IS DELIBERATE AND NARROW. The taxonomy has seventy domains; this file
 * covers a handful. That is a choice, not an omission to be quietly padded
 * later: a paragraph per domain would produce seventy files of material the
 * model already knows, dressed as authoritative BuildHub knowledge, which is
 * worse than having nothing - it launders general knowledge into apparent
 * authority.
 *
 * What earns a place here is knowledge that is (a) practical for BuildHub's
 * users, (b) specific enough that a general answer would be materially worse,
 * and (c) something I can state accurately. Everything else is left to the
 * model's own construction expertise, which is genuinely good at it, and the
 * assistant is told which domains have documents so it does not imply BuildHub
 * has a position where it has none.
 *
 * Each document carries both languages with the SAME facts. Two independently
 * drifting corpora is the failure mode this avoids.
 */
export const CONSTRUCTION_CORE: KnowledgeDocument[] = [
  {
    knowledgeId: 'qs-boq-fundamentals',
    domain: 35,
    subcategory: 'Bills of quantities',
    topic: 'What a bill of quantities is and how it is structured',
    keywords: ['boq', 'bill of quantities', 'takeoff', 'quantity takeoff', 'measurement', 'جدول الكميات', 'حصر', 'مقايسة'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard quantity surveying practice, synthesised',
    reviewDate: '2027-01-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['rate-analysis-fundamentals', 'estimating-assumptions'],
    en: `A bill of quantities (BOQ) is a measured schedule of the work in a
project, priced item by item, so that competing tenders can be compared on the
same basis. It is not a cost estimate; it is the document that makes estimates
comparable.

Structure. A BOQ is normally organised as preliminaries, then measured works by
trade or element, then provisional sums and prime cost sums. Each measured item
carries a description, a unit, a quantity and a rate. The description matters
more than people expect: "blockwork" priced per square metre means nothing
without the block type, thickness, mortar and finish, and vague descriptions are
where tender comparisons quietly stop being comparable.

Units. Work is measured in the unit that drives its cost: volume (m3) for
concrete and excavation, area (m2) for finishes, blockwork and formwork, length
(m) for skirting, kerbs and small pipework, number (nr) for doors, fittings and
sanitaryware, and weight (tonne or kg) for reinforcement and structural steel.

Provisional and prime cost sums. A provisional sum covers work that is known to
be needed but not yet defined; a prime cost sum covers a supplied item whose
selection has not been made. Both are placeholders and both are a common source
of dispute, because they are frequently read as fixed prices when they are not.

Common failures. Measuring from drawings that are superseded; omitting the
preliminaries so the tender looks cheaper than it is; mixing net and gross
quantities within one bill; and pricing a rate against a description that does
not state the specification. In tender comparison, a bill that is significantly
cheaper on one trade is more often a misread description than a genuine saving,
and is worth querying before it is accepted.`,
    ar: `جدول الكميات (BOQ) هو بيان مقاس للأعمال في المشروع، مسعّر بندًا بندًا،
بحيث يمكن مقارنة العطاءات المتنافسة على الأساس نفسه. وهو ليس تقديرًا للتكلفة، بل
هو المستند الذي يجعل التقديرات قابلة للمقارنة.

الهيكل. يُنظَّم جدول الكميات عادةً كأعمال تمهيدية، ثم الأعمال المقاسة حسب البند
أو العنصر، ثم المبالغ الاحتياطية ومبالغ التكلفة الأولية. يحمل كل بند مقاس وصفًا
ووحدة وكمية وسعر فئة. والوصف أهم مما يتصوره الكثيرون: فكلمة «مباني بلوك» مسعّرة
بالمتر المربع لا تعني شيئًا دون نوع البلوك وسمكه والمونة والتشطيب، ومن الأوصاف
الغامضة تفقد مقارنة العطاءات معناها بهدوء.

الوحدات. تُقاس الأعمال بالوحدة التي تحكم تكلفتها: الحجم (م3) للخرسانة والحفر،
المساحة (م2) للتشطيبات والمباني والشدات، الطول (م) للوزر والأرصفة والمواسير
الصغيرة، العدد للأبواب والتجهيزات والأطقم الصحية، والوزن (طن أو كجم) لحديد
التسليح والمنشآت المعدنية.

المبالغ الاحتياطية والأولية. المبلغ الاحتياطي يغطي عملًا معلومًا لكنه غير محدد
بعد؛ ومبلغ التكلفة الأولية يغطي بندًا مورَّدًا لم يُختر بعد. وكلاهما بديل مؤقت،
وكلاهما مصدر شائع للنزاع لأنهما يُقرآن كثيرًا كأسعار نهائية وهما ليسا كذلك.

الأخطاء الشائعة. القياس من رسومات ملغاة؛ إغفال الأعمال التمهيدية ليبدو العطاء
أرخص مما هو عليه؛ خلط الكميات الصافية والإجمالية داخل جدول واحد؛ وتسعير فئة
مقابل وصف لا يذكر المواصفة. وفي مقارنة العطاءات، فإن الجدول الأرخص بفارق كبير في
بند واحد غالبًا ما يكون سوء قراءة للوصف لا وفرًا حقيقيًا، ويستحق الاستفسار قبل
قبوله.`,
  },
  {
    knowledgeId: 'estimating-assumptions',
    domain: 36,
    subcategory: 'Cost estimation discipline',
    topic: 'What must be known before a construction cost estimate means anything',
    keywords: ['cost estimate', 'estimation', 'budget', 'finishing cost', 'price per metre', 'تقدير التكلفة', 'ميزانية', 'تكلفة التشطيب'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard estimating practice, synthesised',
    reviewDate: '2027-01-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['qs-boq-fundamentals', 'rate-analysis-fundamentals'],
    en: `A construction cost figure given without its assumptions is not an
estimate, it is a guess with a decimal point. Before quoting any number, the
following have to be established, because each of them can move the total by
more than the precision the number implies.

Scope. What is included and, more importantly, what is not: structure, finishes,
MEP, joinery, appliances, furniture, external works, authority fees, design
fees, supervision. "Finishing" alone means anything from paint to a turnkey fit
out.

Area and its basis. Gross or net, and whether balconies, shared areas and
service shafts are counted. Two quotes per square metre are not comparable if
one is measured on gross built-up area and the other on net internal.

Specification and quality level. This is usually the largest single driver in
finishing work. Local ceramic and imported porcelain are the same line item and
a multiple apart in cost.

Location. Both for material logistics and for prevailing labour rates. A remote
site carries transport, accommodation and productivity penalties that do not
appear on any material list.

Condition and access. New build, renovation of an occupied property, or a strip
out. Renovation carries demolition, disposal, protection, working-hours limits
and the near-certainty of discovering something.

Currency, date and tax. Which currency, priced when, and whether the figure is
inclusive of VAT and of preliminaries, overhead and profit.

Where prices are volatile - steel, cement, copper, aluminium, imported finishes
- a figure from memory is worse than no figure, because it will be quoted back
with confidence it has not earned. Current market prices should come from a
current source, not from recollection.

Honest practice is to give a RANGE with the assumptions stated, and to say which
assumption would change the answer most.`,
    ar: `رقم تكلفة البناء الذي يُعطى دون افتراضاته ليس تقديرًا، بل تخمين بعلامة
عشرية. وقبل ذكر أي رقم يجب تحديد ما يلي، لأن كل عنصر منها قد يحرّك الإجمالي بأكثر
من الدقة التي يوحي بها الرقم.

نطاق العمل. ما المشمول، والأهم ما غير المشمول: الهيكل، التشطيبات، الأعمال
الكهروميكانيكية، النجارة، الأجهزة، الأثاث، الأعمال الخارجية، رسوم الجهات، أتعاب
التصميم، الإشراف. وكلمة «تشطيب» وحدها تعني أي شيء من الدهان إلى التسليم المفتاحي.

المساحة وأساس قياسها. إجمالية أم صافية، وهل تُحتسب الشرفات والمساحات المشتركة
ومناور الخدمات. فعرضان بالمتر المربع غير قابلين للمقارنة إذا كان أحدهما مقاسًا
على المسطح الإجمالي والآخر على الصافي الداخلي.

المواصفة ومستوى الجودة. وهي عادةً أكبر محرّك منفرد في أعمال التشطيب. فالسيراميك
المحلي والبورسلين المستورد بند واحد وفارق مضاعف في التكلفة.

الموقع. لأجل لوجستيات المواد ولأجل أجور العمالة السائدة. فالموقع النائي يحمل
أعباء نقل وإقامة وانخفاض إنتاجية لا تظهر في أي قائمة مواد.

الحالة وإمكانية الوصول. بناء جديد، أم تجديد لعقار مشغول، أم تكسير وإزالة.
والتجديد يحمل هدمًا وتخلصًا من المخلفات وحمايةً وقيودًا على ساعات العمل، وشبه
يقين باكتشاف ما لم يكن في الحسبان.

العملة والتاريخ والضريبة. أي عملة، ومسعّرة متى، وهل الرقم شامل ضريبة القيمة
المضافة والأعمال التمهيدية والمصروفات العامة والربح.

وحيث تكون الأسعار متقلبة - الحديد والأسمنت والنحاس والألمنيوم والتشطيبات
المستوردة - فإن رقمًا من الذاكرة أسوأ من عدم إعطاء رقم، لأنه سيُنقل بثقة لم
يكتسبها. وأسعار السوق الحالية يجب أن تأتي من مصدر حالي لا من الذاكرة.

والممارسة الأمينة هي إعطاء نطاق مع ذكر الافتراضات، وبيان أي افتراض سيغيّر الإجابة
أكثر من غيره.`,
  },
  {
    knowledgeId: 'waterproofing-selection',
    domain: 12,
    subcategory: 'Selection and failure modes',
    topic: 'Waterproofing system selection and why systems fail',
    keywords: ['waterproofing', 'damp proofing', 'membrane', 'bitumen', 'leak', 'basement', 'roof waterproofing', 'عزل', 'عزل مائي', 'رطوبة', 'تسريب'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard waterproofing practice, synthesised',
    reviewDate: '2027-01-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    en: `Waterproofing is selected by the water condition it must resist, not by
product preference. The three conditions are very different: water that drains
away (roofs, balconies), water held against the structure (planters, tanks,
wet rooms), and water under hydrostatic pressure (basements below the water
table).

Common systems. Torch-applied bitumen membranes are robust and repairable and
remain the default for roofs and podiums. Self-adhesive sheets suit areas where
a flame is unacceptable. Liquid-applied polyurethane and polyurea produce a
seamless finish, which matters where the detailing is complicated. Cementitious
coatings are used inside water-retaining structures and in wet areas.
Crystalline admixtures work within the concrete itself rather than on it.

Detailing is where systems actually fail. In practice the membrane in the field
of a roof is rarely the problem: failures concentrate at upstands, drainage
outlets, pipe penetrations, movement joints, and the junction between horizontal
and vertical surfaces. A system is only as good as its terminations.

Other frequent causes. Applying to a damp, dusty or unprimed substrate; no
falls, so water ponds where it was meant to drain; screed laid over the membrane
without a protection layer, tearing it; no protection board before backfill on
a basement wall; and later trades drilling through a completed membrane.

Inspection. Flood-test horizontal areas before covering them - typically 24 to
48 hours with the outlets plugged - and inspect terminations before the
protection layer goes on. Once a membrane is buried, a leak is found by
demolition.

Selection questions worth asking. What is the water condition; what is the
substrate; will it be trafficked; can it be inspected later; and who is
responsible for protecting it between application and covering.`,
    ar: `يُختار نظام العزل المائي حسب حالة المياه التي يقاومها، لا حسب تفضيل
المنتج. والحالات الثلاث مختلفة تمامًا: مياه تُصرَّف بعيدًا (الأسطح والشرفات)،
ومياه محتجزة ملاصقة للمنشأ (أحواض الزراعة والخزانات والمناطق الرطبة)، ومياه تحت
ضغط هيدروستاتيكي (البدرومات أسفل منسوب المياه الجوفية).

الأنظمة الشائعة. الأغشية البيتومينية المُلحمة بالحرارة متينة وقابلة للإصلاح
وتبقى الخيار الافتراضي للأسطح والمساطب. والألواح ذاتية اللصق تناسب الأماكن التي
لا يُقبل فيها اللهب. أما البولي يوريثان والبولي يوريا السائلان فينتجان تشطيبًا
بلا وصلات، وهو ما يهم حيث تكون التفاصيل معقدة. وتُستخدم الطبقات الأسمنتية داخل
المنشآت الحاجزة للمياه وفي المناطق الرطبة. وتعمل الإضافات البلورية داخل الخرسانة
نفسها لا فوقها.

التفاصيل هي موضع الفشل الفعلي. عمليًا نادرًا ما يكون الغشاء في مسطح السطح هو
المشكلة: فالإخفاقات تتركز عند الحواف الرأسية ومخارج الصرف واختراقات المواسير
وفواصل الحركة وملتقى الأسطح الأفقية بالرأسية. والنظام لا يكون أفضل من نهاياته.

أسباب متكررة أخرى. التنفيذ على أرضية رطبة أو مغبرة أو غير مُبطَّنة بالبرايمر؛
غياب الميول فتتجمع المياه حيث كان يفترض أن تُصرَّف؛ صب الرمل والأسمنت فوق الغشاء
دون طبقة حماية فيتمزق؛ عدم تركيب ألواح حماية قبل الردم على حائط البدروم؛ وثقب
البنود اللاحقة لغشاء مكتمل.

الفحص. اختبر المناطق الأفقية بالغمر قبل تغطيتها - عادةً من 24 إلى 48 ساعة مع سد
المخارج - وافحص النهايات قبل تركيب طبقة الحماية. فبمجرد دفن الغشاء لا يُكتشف
التسريب إلا بالهدم.

أسئلة الاختيار الجديرة بالطرح. ما حالة المياه؛ وما طبيعة الأرضية؛ وهل ستتعرض
للمرور؛ وهل يمكن فحصه لاحقًا؛ ومن المسؤول عن حمايته بين التنفيذ والتغطية.`,
  },
  {
    knowledgeId: 'tender-comparison',
    domain: 40,
    subcategory: 'Tender evaluation',
    topic: 'Comparing contractor quotations without being misled by the lowest number',
    keywords: ['tender', 'quotation', 'compare quotes', 'rfq', 'lowest bid', 'evaluation', 'مقارنة العروض', 'عطاء', 'أقل سعر', 'تقييم'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard procurement practice, synthesised',
    reviewDate: '2027-01-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['qs-boq-fundamentals'],
    en: `The lowest quotation is not automatically the cheapest outcome, and
comparing quotations is mostly the work of making them comparable before
comparing them at all.

Normalise first. Confirm every quotation covers the same scope, the same
specification, the same quantities and the same exclusions. Differences in
exclusions are the most common reason one price looks better: a quote that
excludes MEP first-fix, waste disposal or authority fees is not a lower price,
it is a smaller job.

Then examine the shape of the price, not only the total. An unusually low rate
on one trade often signals a misread specification, and it usually returns later
as a variation. A price that is low overall but front-loaded on early
activities is a cash-flow risk. Rates that are identical across dissimilar items
suggest the bill was priced in bulk rather than measured.

Look at what is behind the number. Programme and whether it is credible for the
resources offered; payment terms; retention; warranty and defects liability
period; who carries the risk on provisional sums; and whether the quoted
resources are actually available in the stated period.

Check the party, not only the paper. Relevant completed work of similar type and
scale; references that can be contacted; financial capacity to carry the
project's cash flow; and required licences and insurances in place and current.

Qualifications matter as much as prices. A quotation that qualifies its price
against drawing revisions, ground conditions or material availability has moved
risk back to the client. That may be reasonable, but it should be recognised and
priced rather than discovered later.`,
    ar: `أقل عرض سعر ليس بالضرورة أرخص نتيجة، ومقارنة العروض هي في معظمها عمل جعل
العروض قابلة للمقارنة قبل مقارنتها أصلًا.

وحّد الأساس أولًا. تأكد أن كل عرض يغطي النطاق نفسه والمواصفة نفسها والكميات نفسها
والاستثناءات نفسها. والاختلاف في الاستثناءات هو السبب الأشيع لظهور سعر أفضل من
غيره: فالعرض الذي يستثني التأسيس الكهروميكانيكي أو إزالة المخلفات أو رسوم الجهات
ليس سعرًا أقل، بل عملًا أصغر.

ثم افحص شكل السعر لا الإجمالي وحده. فالفئة المنخفضة بشكل غير معتاد في بند واحد
تشير غالبًا إلى سوء قراءة المواصفة، وتعود عادةً لاحقًا في صورة أمر تغييري. والسعر
المنخفض إجماليًا لكنه مُحمَّل على الأنشطة المبكرة يمثل خطرًا على التدفق النقدي.
والفئات المتطابقة عبر بنود غير متشابهة توحي بأن الجدول سُعِّر جملةً لا قياسًا.

انظر إلى ما وراء الرقم. البرنامج الزمني ومدى واقعيته مقابل الموارد المعروضة؛
وشروط الدفع؛ ونسبة الضمان المحتجز؛ وفترة الضمان وإصلاح العيوب؛ ومن يتحمل مخاطر
المبالغ الاحتياطية؛ وهل الموارد المعروضة متاحة فعلًا في الفترة المذكورة.

افحص الطرف لا الورق فقط. أعمال منجزة مماثلة في النوع والحجم؛ ومراجع يمكن
الاتصال بها؛ وقدرة مالية على تحمل التدفق النقدي للمشروع؛ وتراخيص وتأمينات مطلوبة
سارية.

والتحفظات لا تقل أهمية عن الأسعار. فالعرض الذي يقيّد سعره بمراجعات الرسومات أو
طبيعة التربة أو توافر المواد قد أعاد المخاطر إلى المالك. وقد يكون ذلك معقولًا،
لكن يجب إدراكه وتسعيره لا اكتشافه لاحقًا.`,
  },
];
