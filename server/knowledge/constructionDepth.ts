import type { KnowledgeDocument } from '@shared/knowledgeTaxonomy';

/**
 * The second tranche of the construction corpus.
 *
 * Written to the depth checklist rather than to a word count: what a thing is,
 * what it is for, how it is chosen, how it fails, how failure is caught, what
 * drives its cost, and what people get wrong. A paragraph that could be
 * produced by a model with no corpus at all is not worth storing - the reason
 * to hold a document is that it OUTRANKS general recollection, and it only
 * earns that by being specific.
 *
 * Authority tier 6 throughout: this is synthesised professional practice, not
 * a regulator or a standards body. Where a real requirement is jurisdictional -
 * a cover depth, a fire rating, a test frequency - these documents say so and
 * point at the code rather than inventing the number. That boundary is the
 * whole reason server/knowledge/jurisdictions.ts exists separately.
 */
export const CONSTRUCTION_DEPTH: KnowledgeDocument[] = [
  {
    knowledgeId: 'concrete-mix-and-strength',
    domain: 6,
    subcategory: 'Concrete mixes, strength and acceptance',
    topic: 'How concrete grade is specified, achieved, and proven on site',
    keywords: ['concrete', 'mix design', 'grade', 'c25', 'c30', 'compressive strength', 'cube test', 'cylinder test', 'slump', 'water cement ratio', 'curing', 'ready mix', 'خرسانة', 'خلطة', 'مقاومة', 'مكعبات', 'هبوط', 'معالجة'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard concrete technology and site practice, synthesised',
    reviewDate: '2027-06-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['qaqc-inspection-regime', 'estimating-assumptions'],
    en: `Concrete grade is a specification of STRENGTH AT AN AGE, not a recipe.
"C30" means characteristic compressive strength of 30 MPa at 28 days, measured
on standard specimens, with a defined proportion of results permitted to fall
below it. The mix that achieves it is the supplier's problem; proving it was
achieved is yours.

WHAT ACTUALLY CONTROLS STRENGTH. Water/cement ratio dominates - more water means
weaker, more porous, more permeable concrete, and it is the single easiest thing
to get wrong because adding water makes concrete easier to place. Cement content,
aggregate grading and shape, admixtures, and above all CURING then modify the
result. Concrete that is allowed to dry out in the first days does not later
recover the strength it lost; in hot climates this is the most common cause of
in-situ strength falling short of the cubes.

SPECIFYING IT PROPERLY. A grade alone is not a specification. State the grade,
the maximum aggregate size, the workability (slump or flow class), the exposure
condition, the cement type, and any durability requirement - and note that
DURABILITY, not strength, usually governs in aggressive ground. Sulfate-bearing
or chloride-bearing soil, splash zones and marine exposure all demand mix
constraints that a strength number does not capture.

WORKABILITY AND ITS ABUSE. Slump is a measure of consistency, not quality. The
critical rule is that water must NOT be added on site to restore slump lost in
transit; if concrete has stiffened beyond the specified range it should be
rejected, not watered. Where placement is genuinely difficult, the answer is a
plasticiser designed into the mix, not a hose.

PROVING IT. Acceptance rests on sampling at the point of placement, cast and
cured under controlled conditions, tested at the specified ages. Sampling
frequency, specimen type (cube or cylinder), and the acceptance criteria are set
by the governing code - which differs by jurisdiction, so read it rather than
assuming. If cubes fail, the sequence is investigation before condemnation:
review the test records, then consider in-situ methods - rebound hammer for
uniformity only, ultrasonic pulse velocity, and cores as the definitive check.
A single low result is a question; a trend is a finding.

COMMON DEFECTS AND WHAT THEY MEAN. Honeycombing indicates poor compaction or a
mix too harsh for the reinforcement congestion. Plastic shrinkage cracking
within hours points at rapid surface evaporation - wind, heat, low humidity -
and is a curing and protection failure. Cold joints mean the pour sequence
outran the supply. Crazing is a surface finishing issue, generally cosmetic.
Efflorescence signals water movement through the section. Each has a different
remedy and misdiagnosing one as another wastes the repair.

COST DRIVERS. Grade itself moves cost less than people expect; what moves it is
cement content, admixtures, aggregate haul distance, pump versus crane
placement, pour size and access, night work, and waste. Small scattered pours
cost far more per cubic metre than one large one, and the difference rarely
appears in a rate comparison.

PROCUREMENT. Buying ready-mixed concrete on price per cubic metre alone invites
the cheapest compliant-on-paper mix. Ask for the mix design, evidence of past
compliance, plant QC records, and realistic delivery rates for your pour size -
a supplier who cannot sustain your placing rate will hand you cold joints.

SUSTAINABILITY. Cement is the carbon in concrete. Substituting a portion with
ground granulated blast-furnace slag or fly ash lowers embodied carbon and often
improves durability, at the cost of slower early strength - which changes the
striking schedule and must be planned, not discovered.

SAFETY. Fresh concrete is caustic; skin and eye contact cause burns that
develop slowly enough to be ignored. Pump lines carry lethal pressure and
blockages must never be cleared by opening a line under pressure. Falls into
open pours and formwork collapse during placement are the other two recurring
serious risks.

THE MISTAKES THAT RECUR. Adding water at the truck. Specifying strength when
durability governs. Curing for a day because the surface looked dry. Comparing
suppliers on rate with no mix design. Treating a rebound hammer number as a
strength result. Accepting a pour that arrived outside its specified time from
batching.`,
    ar: `درجة الخرسانة هي مواصفة لمقاومة عند عمر محدد، وليست وصفة خلط. فـ"C30"
تعني مقاومة ضغط مميزة 30 ميجاباسكال عند 28 يومًا على عينات قياسية، مع نسبة
مسموح بها من النتائج تقل عن ذلك. تحقيق الخلطة مسؤولية المورّد، أما إثبات تحققها
فمسؤوليتك.

ما يتحكم فعليًا في المقاومة. نسبة الماء إلى الأسمنت هي العامل الحاكم: زيادة
الماء تعني خرسانة أضعف وأكثر مسامية ونفاذية، وهي أسهل خطأ يقع لأن إضافة الماء
تسهّل الصب. ثم يأتي محتوى الأسمنت وتدرج الركام وشكله والإضافات، وقبل ذلك كله
المعالجة. الخرسانة التي تُترك لتجف في أيامها الأولى لا تستعيد ما فقدته من
مقاومة، وهذا في المناخ الحار أشيع أسباب قصور المقاومة الفعلية عن نتائج المكعبات.

المواصفة الصحيحة. الدرجة وحدها ليست مواصفة. يجب تحديد الدرجة وأكبر مقاس للركام
ودرجة القابلية للتشغيل (الهبوط أو فئة الانسياب) وظروف التعرض ونوع الأسمنت وأي
اشتراط للديمومة — مع ملاحظة أن الديمومة لا المقاومة هي الحاكم غالبًا في التربة
العدوانية. فالتربة الكبريتية أو الكلوريدية ومناطق الرذاذ والتعرض البحري تفرض
قيودًا على الخلطة لا يعبّر عنها رقم المقاومة.

القابلية للتشغيل وإساءة استخدامها. الهبوط مقياس قوام لا مقياس جودة. والقاعدة
الحاسمة ألا يُضاف ماء في الموقع لتعويض الهبوط المفقود أثناء النقل؛ فإذا تيبّست
الخرسانة خارج المدى المحدد تُرفض ولا تُروى. وإذا كان الصب صعبًا فعلًا فالحل ملدّن
مصمم ضمن الخلطة، لا خرطوم ماء.

الإثبات. القبول يقوم على أخذ العينات عند نقطة الصب، وصبها ومعالجتها في ظروف
منضبطة، واختبارها في الأعمار المحددة. أما تكرار العينات ونوعها (مكعب أو أسطوانة)
ومعايير القبول فيحددها الكود الساري، وهو يختلف من دولة لأخرى، فيجب الرجوع إليه
لا افتراضه. وعند فشل المكعبات يكون التسلسل تحقيقًا قبل الإدانة: مراجعة سجلات
الاختبار، ثم الطرق الموقعية — مطرقة الارتداد لبيان التجانس فقط، والموجات فوق
الصوتية، والعينات اللبية (Cores) كفصل نهائي. النتيجة المنخفضة الواحدة سؤال، أما
الاتجاه المتكرر فنتيجة.

العيوب الشائعة ودلالتها. التعشيش يدل على سوء دمك أو خلطة قاسية على تزاحم
التسليح. وتشققات الانكماش اللدن خلال ساعات تشير إلى تبخر سطحي سريع — رياح أو
حرارة أو رطوبة منخفضة — وهي إخفاق في المعالجة والحماية. والوصلات الباردة تعني أن
تتابع الصب سبق التوريد. والتشقق الشعري السطحي مسألة تشطيب وغالبًا تجميلي. أما
التزهر الملحي فيدل على حركة ماء خلال القطاع. ولكل منها علاج مختلف، وتشخيص أحدها
مكان الآخر يهدر الإصلاح.

محركات التكلفة. الدرجة نفسها تحرك التكلفة أقل مما يُظن؛ الذي يحركها هو محتوى
الأسمنت والإضافات ومسافة نقل الركام والصب بالمضخة مقابل الونش وحجم الصبة
وإمكانية الوصول والعمل الليلي والهدر. والصبات الصغيرة المتفرقة أغلى بكثير للمتر
المكعب من صبة واحدة كبيرة، وهذا الفارق نادرًا ما يظهر في مقارنة الفئات.

المشتريات. شراء الخرسانة الجاهزة بسعر المتر المكعب وحده يستدعي أرخص خلطة مطابقة
على الورق. اطلب تصميم الخلطة وأدلة المطابقة السابقة وسجلات ضبط الجودة بالمحطة
ومعدلات توريد واقعية لحجم صبتك؛ فالمورّد العاجز عن مجاراة معدل الصب سيسلّمك
وصلات باردة.

الاستدامة. الأسمنت هو كربون الخرسانة. واستبدال جزء منه بخبث الأفران المحبب أو
الرماد المتطاير يخفض الكربون المتضمَّن ويحسّن الديمومة غالبًا، مقابل بطء اكتساب
المقاومة المبكرة — وهو ما يغيّر جدول فك الشدات ويجب تخطيطه لا اكتشافه.

السلامة. الخرسانة الطازجة كاوية، وملامستها للجلد والعين تسبب حروقًا تتطور ببطء
يجعل تجاهلها سهلًا. وخطوط المضخات تحمل ضغطًا قاتلًا، ولا يجوز مطلقًا فك خط تحت
ضغط لمعالجة انسداد. أما السقوط في الصبات المفتوحة وانهيار الشدات أثناء الصب
فهما الخطران الجسيمان المتكرران الآخران.

الأخطاء المتكررة. إضافة الماء عند الخلاطة. تحديد المقاومة حين تكون الديمومة هي
الحاكم. المعالجة ليوم واحد لأن السطح بدا جافًا. مقارنة الموردين بالفئة دون تصميم
خلطة. اعتبار قراءة مطرقة الارتداد نتيجة مقاومة. قبول صبة وصلت بعد تجاوز الزمن
المحدد من الخلط.`,
  },
  {
    knowledgeId: 'qaqc-inspection-regime',
    domain: 47,
    subcategory: 'Quality assurance and site inspection',
    topic: 'How quality is actually controlled on a construction site',
    keywords: ['qa', 'qc', 'quality control', 'quality assurance', 'inspection', 'itp', 'inspection and test plan', 'snagging', 'punch list', 'ncr', 'non conformance', 'hold point', 'جودة', 'ضبط الجودة', 'تفتيش', 'خطة تفتيش', 'عدم مطابقة', 'ملاحظات'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard QA/QC and site supervision practice, synthesised',
    reviewDate: '2027-06-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['concrete-mix-and-strength', 'handover-and-commissioning'],
    en: `Quality assurance and quality control are not the same activity. QA is
the SYSTEM that makes conforming work likely - procedures, competence,
approved materials, method statements. QC is the CHECKING that it happened -
inspection, testing, records. A project with heavy QC and no QA finds the same
defect repeatedly; a project with QA and no QC believes it has no defects.

THE INSPECTION AND TEST PLAN is the spine. For each activity it names what is
checked, against which specification clause, by whom, at what frequency, what
record is produced, and - critically - which points are HOLD POINTS where work
may not proceed until released, versus WITNESS POINTS where the inspector is
invited but absence does not stop work. Confusing the two is how work gets
covered up before it is seen. Steel fixing before concrete, waterproofing before
screed, and services before ceiling closure are the classic hold points, because
each becomes expensive or impossible to inspect afterwards.

MATERIAL CONTROL. Approve materials before delivery, not after installation.
Check delivered material against the approved submittal - not against the
drawing, and not against what was delivered last time. Verify batch and
certificate traceability for anything structural or safety-critical, and store
material as the manufacturer requires; cement, adhesives, membranes and sealants
all have shelf lives and storage conditions that site conditions routinely
violate.

NON-CONFORMANCE. A non-conformance report exists to force a decision, not to
assign blame. The four possible dispositions are rework to specification, repair
to an approved method, USE AS IS with documented technical justification, and
reject. "Use as is" is legitimate and is also the one most often abused: it
requires the designer's acceptance and a written reason, not a site agreement.
Every NCR should end with a cause, because an NCR that closes without one will
be reopened under a different number.

SNAGGING IS NOT QUALITY CONTROL. A punch list at the end catches appearance
defects on finished surfaces. It cannot catch a missing damp-proof membrane, an
untested pipe or an unbonded screed. Projects that rely on final snagging as
their quality regime discover their real defects during the defects liability
period, when access is worst and leverage is lowest.

INSPECTION IN PRACTICE. Inspect against a document, not an impression - a
checklist tied to the specification clause. Record what was seen, dated and
photographed, with location referenced to a grid or room number rather than
"second floor near the lift". Sample intelligently: 100% inspection of a
repetitive trade is neither possible nor useful, but a sample that is always
taken from the easiest location is not a sample.

COST. Quality is cheapest at the point of work and most expensive after
handover; the ratio is not marginal. A membrane lap re-done during installation
costs minutes, the same lap found after screed and tiling costs the finished
floor, and found after occupation costs the floor plus the occupant's loss.
Budgeting for inspection is buying down that curve.

MAINTENANCE OF THE RECORD. The QA record is the evidence used in a dispute
years later. Test certificates, approved submittals, inspection records, NCRs
and their closeouts, and as-built information should be assembled as the work
proceeds. Assembling them at handover means reconstructing them, and a
reconstructed record convinces nobody.

THE MISTAKES THAT RECUR. Signing an inspection that was not performed. Treating
the ITP as a document produced for the client rather than used by the team.
Allowing work to cover a hold point "to keep the programme". Approving a
material substitution on price without checking the performance it was chosen
for. Closing NCRs without causes. Leaving commissioning evidence to the end.`,
    ar: `توكيد الجودة وضبط الجودة ليسا نشاطًا واحدًا. فتوكيد الجودة هو النظام الذي
يجعل العمل المطابق مُرجَّحًا: الإجراءات والكفاءات والمواد المعتمدة وطرق التنفيذ.
أما ضبط الجودة فهو التحقق من حدوث ذلك: التفتيش والاختبار والسجلات. والمشروع الذي
يكثر فيه الضبط ويغيب التوكيد يكتشف العيب نفسه مرارًا؛ والمشروع الذي فيه توكيد بلا
ضبط يظن أنه بلا عيوب.

خطة التفتيش والاختبار هي العمود الفقري. فهي تحدد لكل نشاط ما الذي يُفحص، ومقابل
أي بند في المواصفات، وبواسطة من، وبأي تكرار، وأي سجل يُنتج، والأهم: أي النقاط
نقاط توقف (Hold Points) لا يجوز تجاوزها قبل الإفراج، وأيها نقاط إشهاد (Witness
Points) يُدعى إليها المفتش دون أن يوقف غيابه العمل. والخلط بينهما هو السبب في
تغطية الأعمال قبل معاينتها. وتُعد أعمال التسليح قبل الصب، والعزل قبل الصبة
الخفيفة، والخدمات قبل إقفال الأسقف المستعارة نقاط التوقف الكلاسيكية، لأن كلًا
منها يصبح مكلفًا أو مستحيلًا للفحص لاحقًا.

ضبط المواد. اعتمد المواد قبل التوريد لا بعد التركيب. وطابق المورَّد على العينة
المعتمدة، لا على الرسم ولا على ما ورد المرة السابقة. وتحقق من تتبع التشغيلة
والشهادات لكل ما هو إنشائي أو حرج للسلامة، وخزّن المواد كما يشترط المصنّع؛
فالأسمنت والمواد اللاصقة والأغشية والمواد المانعة للتسرب لها جميعًا أعمار تخزينية
وظروف حفظ تخالفها ظروف المواقع باستمرار.

عدم المطابقة. تقرير عدم المطابقة موجود لفرض قرار لا لتوزيع اللوم. والتصرفات
الأربعة الممكنة هي: إعادة التنفيذ حسب المواصفة، أو الإصلاح بأسلوب معتمد، أو
القبول كما هو بمبرر فني موثّق، أو الرفض. والقبول كما هو مشروع، وهو أيضًا الأكثر
إساءة استخدام: فهو يتطلب قبول المصمم وسببًا مكتوبًا، لا اتفاقًا في الموقع. وينبغي
أن ينتهي كل تقرير بسبب جذري، فالتقرير الذي يُغلق دون سبب سيُفتح ثانية برقم آخر.

قوائم الملاحظات ليست ضبط جودة. فقائمة الملاحظات في النهاية تلتقط عيوب المظهر على
الأسطح المنتهية، ولا يمكنها التقاط غشاء عزل مفقود أو ماسورة غير مختبرة أو صبة
غير متماسكة. والمشاريع التي تعتمد الملاحظات النهائية نظامًا للجودة تكتشف عيوبها
الحقيقية في فترة ضمان العيوب، حين يكون الوصول أسوأ والقدرة التفاوضية أضعف.

التفتيش عمليًا. افحص مقابل مستند لا مقابل انطباع: قائمة فحص مرتبطة ببند المواصفة.
وسجّل ما رأيته مؤرخًا ومصورًا، مع تحديد الموقع بمحور أو رقم غرفة لا بعبارة
"الدور الثاني بجوار المصعد". وخذ العينات بذكاء: الفحص الكامل لبند متكرر غير ممكن
ولا مفيد، لكن العينة المأخوذة دائمًا من أسهل موضع ليست عينة.

التكلفة. الجودة أرخص ما تكون عند لحظة التنفيذ وأغلى ما تكون بعد التسليم، والفارق
ليس هامشيًا. فإعادة تراكب غشاء عزل أثناء التركيب تكلف دقائق، والتراكب نفسه إذا
اكتُشف بعد الصبة والبلاط يكلف الأرضية كاملة، وإذا اكتُشف بعد الإشغال كلّف الأرضية
وخسارة الشاغل معها. وميزانية التفتيش هي شراء لموضع أدنى على هذا المنحنى.

حفظ السجل. سجل الجودة هو الدليل المستخدم في أي نزاع بعد سنوات. لذا تُجمع شهادات
الاختبار والعينات المعتمدة وسجلات التفتيش وتقارير عدم المطابقة وإغلاقاتها ومعلومات
ما بعد التنفيذ أولًا بأول. أما جمعها عند التسليم فيعني إعادة تركيبها، والسجل
المعاد تركيبه لا يقنع أحدًا.

الأخطاء المتكررة. توقيع تفتيش لم يُجرَ. التعامل مع خطة التفتيش كمستند يُنتج
للعميل لا كأداة يستخدمها الفريق. السماح بتغطية نقطة توقف "حفاظًا على البرنامج".
اعتماد استبدال مادة على أساس السعر دون فحص الأداء الذي اختيرت من أجله. إغلاق
تقارير عدم المطابقة بلا أسباب. تأجيل أدلة التشغيل التجريبي إلى النهاية.`,
  },
  {
    knowledgeId: 'variations-and-claims',
    domain: 52,
    subcategory: 'Variations, claims and entitlement',
    topic: 'How construction variations and claims actually succeed or fail',
    keywords: ['variation', 'change order', 'claim', 'extension of time', 'eot', 'delay', 'disruption', 'prolongation', 'notice', 'entitlement', 'contract', 'أمر تغيير', 'مطالبة', 'تمديد المدة', 'تأخير', 'إخطار', 'استحقاق', 'عقد'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard contract administration practice, synthesised',
    reviewDate: '2027-06-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['tender-comparison', 'qaqc-inspection-regime'],
    en: `A variation is a change to the scope the contract already allows the
employer to instruct. A claim is an assertion of entitlement to more time or
money arising from something that happened. They are governed by different
mechanics and confusing them is the most common reason a well-founded position
fails.

THE THREE THINGS EVERY CLAIM NEEDS. Entitlement - a contractual clause or legal
basis that says this event gives rise to this remedy. Causation - evidence that
the event actually caused the effect claimed, not merely that both occurred.
Quantum - the sum or the time, calculated by a method the contract recognises.
A claim strong on one and silent on another does not partly succeed; it
generally fails.

NOTICE IS USUALLY DECISIVE. Most standard forms require notice within a stated
period of the event or of when the contractor became aware of it, and many make
that notice a CONDITION PRECEDENT - meaning a late notice destroys an otherwise
valid entitlement entirely. The practical discipline is unglamorous: notify
early, notify in the contractual form, notify to the named recipient, and keep
proof of service. Contractors lose more money to missed notices than to weak
arguments.

INSTRUCTIONS AND WHO MAY GIVE THEM. Only the person the contract names may
instruct a variation. Work done on a site conversation with someone who lacks
authority is work done at risk, however senior they appeared. If an instruction
arrives verbally, confirm it in writing and say that you are proceeding on that
basis - the confirmation is what converts a conversation into an instruction.

VALUING A VARIATION. The usual hierarchy is: BOQ rates where the work is of
similar character and conditions, then rates derived from BOQ rates, then fair
valuation. The argument is almost always about whether conditions changed
enough to break the similarity - the same blockwork at height, in an occupied
building, or out of sequence is not the same blockwork. Say so at the time,
with the reason, rather than accepting the rate and arguing later.

DELAY: THE DISTINCTIONS THAT DECIDE OUTCOMES. Only delay to the CRITICAL PATH
earns an extension of time; delay to float generally does not. Excusable delay
earns time; compensable delay earns time AND money, and the two sets are not
identical - weather or an epidemic may excuse without compensating. Concurrent
delay, where an employer risk event and a contractor risk event overlap,
typically yields time without money, though this varies by jurisdiction and by
form. Establish the critical path with a properly maintained programme, updated
with actual progress; a programme rebuilt after the fact to support a claim is
usually recognisable as such.

DISRUPTION IS NOT DELAY. Disruption is loss of productivity without necessarily
delaying completion - the same work taking more hours. It is genuinely
recoverable and genuinely hard to prove, because it requires demonstrating what
productivity WOULD have been. Measured mile comparisons, using an undisrupted
period of the same work, are far more persuasive than a global claim that
subtracts planned hours from actual and calls the difference disruption.

RECORDS ARE THE WHOLE CASE. Daily labour and plant returns, progress
photographs with dates and locations, site instructions, correspondence,
programme updates, and minutes. The party with contemporaneous records usually
prevails over the party with the better narrative, because the records were made
before anyone knew what would be in dispute.

COST AND COMMERCIAL REALITY. Claims consume management time, damage
relationships and often settle for a fraction of their face value. That is an
argument for raising issues early and small, when they can be resolved as
variations, rather than accumulating them into a final account confrontation.

THE MISTAKES THAT RECUR. Proceeding on a verbal instruction. Missing a
condition-precedent notice. Claiming a global sum with no causal chain. Treating
float as the contractor's alone when the contract does not say so. Failing to
update the programme. Signing a final account that waives claims not yet
quantified.`,
    ar: `أمر التغيير تعديل في نطاق العمل يسمح العقد أصلًا لصاحب العمل بإصداره. أما
المطالبة فهي ادعاء باستحقاق وقت أو مال إضافي نتيجة واقعة حدثت. ولكل منهما آلية
مختلفة، والخلط بينهما أشيع أسباب سقوط موقف سليم في أصله.

ثلاثة أركان لكل مطالبة. الاستحقاق: بند تعاقدي أو أساس قانوني يقرر أن هذه الواقعة
تُنشئ هذا التعويض. والسببية: دليل على أن الواقعة سببت الأثر المُطالَب به فعلًا، لا
مجرد أنهما وقعا معًا. والكم: المبلغ أو المدة محسوبًا بأسلوب يعترف به العقد.
والمطالبة القوية في ركن الصامتة عن آخر لا تنجح جزئيًا، بل تسقط غالبًا.

الإخطار هو الحاسم عادة. تشترط أغلب العقود النمطية إخطارًا خلال مدة محددة من
الواقعة أو من علم المقاول بها، ويجعل كثير منها هذا الإخطار شرطًا واقفًا — أي أن
تأخره يُسقط استحقاقًا صحيحًا تمامًا. والانضباط العملي هنا غير براق: أخطر مبكرًا،
وبالشكل التعاقدي، وإلى الجهة المسماة، واحتفظ بدليل التسليم. والمقاولون يخسرون
بسبب إخطارات فائتة أكثر مما يخسرون بسبب حجج ضعيفة.

التعليمات ومن يملك إصدارها. لا يصدر أمر التغيير إلا ممن سماه العقد. والعمل بناءً
على حديث في الموقع مع من لا يملك الصلاحية عمل على مسؤولية المقاول مهما بدا موقع
المتحدث. وإذا وردت تعليمات شفهية فأكّدها كتابةً وأعلن أنك تمضي على أساسها؛ فهذا
التأكيد هو ما يحوّل الحديث إلى تعليمات.

تقييم أمر التغيير. التدرج المعتاد: فئات جدول الكميات حيث يكون العمل مشابهًا في
طبيعته وظروفه، ثم فئات مشتقة منها، ثم التقييم العادل. والخلاف يدور دائمًا تقريبًا
حول ما إذا كانت الظروف تغيرت بما يكفي لكسر التشابه — فالمباني نفسها على ارتفاع،
أو في مبنى مشغول، أو خارج التتابع، ليست العمل نفسه. قل ذلك في حينه مع السبب، بدل
قبول الفئة والاعتراض لاحقًا.

التأخير: الفروق التي تحسم النتيجة. لا يستحق تمديد المدة إلا التأخير الواقع على
المسار الحرج؛ أما التأخير على الوقت العائم فلا يستحق غالبًا. والتأخير المعذور
يمنح وقتًا، والتأخير المستوجب للتعويض يمنح وقتًا ومالًا، والمجموعتان غير
متطابقتين — فالطقس أو الوباء قد يعذر دون أن يعوّض. أما التأخير المتزامن، حيث
تتداخل واقعة من مسؤولية صاحب العمل مع أخرى من مسؤولية المقاول، فيؤدي عادة إلى
وقت بلا مال، وإن اختلف ذلك بالولاية القضائية وبنموذج العقد. ويُثبت المسار الحرج
ببرنامج مُحدَّث بانتظام بالتقدم الفعلي؛ أما البرنامج الذي يُعاد بناؤه لاحقًا لدعم
مطالبة فغالبًا ما يُكتشف على حقيقته.

التعطيل ليس تأخيرًا. التعطيل هو فقد الإنتاجية دون أن يؤخر الإنجاز بالضرورة: العمل
نفسه يستغرق ساعات أكثر. وهو قابل للتعويض فعلًا وصعب الإثبات فعلًا، لأنه يتطلب
إثبات ما كانت ستكون عليه الإنتاجية. ومقارنات "الميل المقيس"، باستخدام فترة غير
معطلة من العمل نفسه، أقوى إقناعًا بكثير من مطالبة إجمالية تطرح الساعات المخططة من
الفعلية وتسمي الفارق تعطيلًا.

السجلات هي القضية كلها. تقارير العمالة والمعدات اليومية، وصور التقدم بتواريخها
ومواقعها، وتعليمات الموقع، والمراسلات، وتحديثات البرنامج، والمحاضر. والطرف صاحب
السجلات المعاصرة يتفوق عادة على الطرف صاحب السرد الأفضل، لأن السجلات دُوّنت قبل
أن يعلم أحد ما الذي سيصير محل نزاع.

الواقع التجاري. المطالبات تستهلك وقت الإدارة وتضر بالعلاقات وتُسوّى غالبًا بجزء من
قيمتها الاسمية. وهذه حجة لإثارة المسائل مبكرة وصغيرة، حين يمكن حلها كأوامر تغيير،
بدل تراكمها إلى مواجهة في الحساب الختامي.

الأخطاء المتكررة. المضي بتعليمات شفهية. تفويت إخطار هو شرط واقف. المطالبة بمبلغ
إجمالي بلا سلسلة سببية. اعتبار الوقت العائم ملكًا للمقاول وحده حيث لا ينص العقد
على ذلك. إهمال تحديث البرنامج. توقيع حساب ختامي يتنازل عن مطالبات لم تُحصر بعد.`,
  },
];
