import type { KnowledgeDocument } from '@shared/knowledgeTaxonomy';

/**
 * Trade and site-execution knowledge: the domains where a wrong answer costs
 * the most on a real project.
 *
 * Chosen by consequence, not by filling the taxonomy in order. Steel and
 * foundations because the failures are structural; MEP because it is where
 * coordination failures surface as demolition; fire protection because it is
 * where a compliance failure stops handover; finishes because it is the largest
 * share of a fit-out budget and the most disputed; safety because the cost is
 * measured in people.
 *
 * Every document is tier 6 - synthesised professional practice. Where a real
 * requirement is jurisdictional, these say so and point at the code rather than
 * stating a number. That boundary is the whole reason
 * server/knowledge/jurisdictions.ts exists separately, and it is not relaxed
 * here because a number would have been convenient.
 */
export const CONSTRUCTION_TRADES: KnowledgeDocument[] = [
  {
    knowledgeId: 'reinforcement-steel-practice',
    domain: 7,
    subcategory: 'Reinforcement steel: supply, fixing and acceptance',
    topic: 'Reinforcement steel - grades, fixing, corrosion and what goes wrong',
    keywords: ['rebar', 'reinforcement', 'steel bar', 'stirrup', 'lap length', 'splice', 'cover', 'corrosion', 'bar bending schedule', 'bbs', 'mill certificate', 'حديد التسليح', 'تسليح', 'كانات', 'وصلات', 'غطاء خرساني', 'صدأ', 'جدول الحديد'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard reinforced concrete site practice, synthesised',
    reviewDate: '2027-06-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['concrete-mix-and-strength', 'qaqc-inspection-regime'],
    en: `Reinforcement carries the tension that concrete cannot. Everything about
handling it on site follows from two facts: it only works where the designer put
it, and it only lasts as long as the concrete around it protects it.

GRADE AND IDENTIFICATION. Bars are specified by yield strength and ductility
class, and the two are not interchangeable - substituting a higher-strength bar
for a specified one changes how the section fails, which is a design decision
and not a procurement one. Every delivery should be traceable to a mill
certificate covering the tested batch, and bars should be identifiable on site
by their rolled marks. Untraceable steel on a structural element is a defect
regardless of how it looks.

COVER IS THE DURABILITY DESIGN. The concrete between the bar and the surface is
what keeps carbonation and chlorides away from the steel; too little and the
structure has a shortened life designed into it from day one. THE REQUIRED COVER
IS SET BY THE GOVERNING CODE FOR THE EXPOSURE CONDITION and differs by
jurisdiction - read it rather than assuming, and never carry a figure across
from another country's practice. What is universal is the site discipline:
purpose-made spacers at adequate frequency, never stone or rebar offcuts, and
cover checked before the pour rather than argued about after it.

LAPS, ANCHORAGE AND CONGESTION. Lap and anchorage lengths depend on bar size,
concrete grade, bar position and confinement, and are code-derived - the
schedule is not a suggestion. Laps staggered as detailed, not all in one plane.
Where reinforcement is congested - column-beam junctions especially - the real
constraint is whether concrete can actually pass between the bars; a section
that cannot be compacted will honeycomb no matter how correct the steel is, and
the time to discover that is at detailing, not at the pour.

FIXING. Bars tied to hold position under the weight of workers and the pressure
of placement, not merely to sit still while photographed. Chairs and spacers
sized so the top steel stays at its designed level - dropped top steel in a
cantilever is a structural failure waiting for a load, and it is invisible once
the pour starts. Access routes planned so nobody walks the top mat into
depression.

CORROSION AND STORAGE. Light surface rust is normal and generally acceptable -
it improves bond. Flaking, pitted or delaminating rust is not. Store bars off
the ground and clear of chlorides; keep them away from any source of salt.
Contamination with oil, mud or curing compound breaks bond and must be cleaned
before the pour.

COST DRIVERS. Steel price by weight is only part of it. Waste from poor bending
schedules, cutting lists that ignore stock lengths, over-detailing that creates
congestion, and remedial work from misplaced bars often exceed the price
difference between suppliers. A bar bending schedule prepared from the drawings
by someone who will not be fixing the steel is where much of that waste starts.

INSPECTION. Steel fixing is the classic HOLD POINT: once the pour begins, the
inspection is over forever. Check bar size, spacing, number, laps, cover,
cleanliness and the position of openings and starter bars, against the drawing
and schedule, and record it with photographs referenced to grid lines.

THE MISTAKES THAT RECUR. Substituting bar grade on price. Stone spacers. Top
steel walked down. Laps all in one section. Cover assumed from another project.
Starter bars omitted or misplaced for the next lift. Pouring before the
inspection because the truck arrived.`,
    ar: `يحمل التسليح قوى الشد التي تعجز عنها الخرسانة. وكل ما يتعلق بالتعامل معه
في الموقع ينبع من حقيقتين: أنه لا يعمل إلا في الموضع الذي وضعه فيه المصمم، ولا
يدوم إلا بقدر ما تحميه الخرسانة المحيطة به.

الرتبة والتمييز. تُحدَّد الأسياخ بإجهاد الخضوع وفئة المطاوعة، وهما غير قابلين
للاستبدال؛ فاستبدال سيخ أعلى مقاومة بآخر محدد يغيّر طريقة انهيار القطاع، وهذا
قرار تصميمي لا قرار مشتريات. ويجب أن يكون كل توريد قابلًا للتتبع إلى شهادة مصنع
تغطي التشغيلة المختبَرة، وأن تُميَّز الأسياخ في الموقع بعلاماتها المدرفلة. والحديد
غير القابل للتتبع في عنصر إنشائي عيب مهما بدا مظهره جيدًا.

الغطاء الخرساني هو تصميم الديمومة. الخرسانة بين السيخ والسطح هي ما يبعد الكربنة
والكلوريدات عن الحديد؛ فنقصها يعني عمرًا أقصر مصممًا في المنشأ من يومه الأول.
والغطاء المطلوب يحدده الكود الساري وفق ظروف التعرض ويختلف من دولة لأخرى، فارجع
إليه ولا تفترضه، ولا تنقل رقمًا من ممارسة بلد آخر. أما الثابت فهو انضباط الموقع:
فواصل مصنّعة لهذا الغرض بتكرار كافٍ، لا أحجار ولا بواقي حديد، ومراجعة الغطاء قبل
الصب لا الجدال حوله بعده.

الوصلات والإرساء والتزاحم. تعتمد أطوال الوصل والإرساء على قطر السيخ ورتبة
الخرسانة وموضع السيخ ودرجة الحصر، وهي مشتقة من الكود، والجدول ليس اقتراحًا.
وتُوزَّع الوصلات متبادلة كما هو مفصَّل لا في مستوى واحد. وحيث يتزاحم التسليح —
خاصة في وصلات الأعمدة والكمرات — يكون القيد الحقيقي هو قدرة الخرسانة على المرور
بين الأسياخ؛ فالقطاع الذي لا يمكن دمكه سيُعشِّش مهما كان تسليحه صحيحًا، ووقت
اكتشاف ذلك هو مرحلة التفصيل لا لحظة الصب.

التركيب. تُربط الأسياخ لتثبت تحت وزن العمال وضغط الصب، لا لتبقى ساكنة أثناء
التصوير فقط. وتُختار الكراسي والفواصل بمقاسات تُبقي الحديد العلوي في منسوبه
المصمم؛ فهبوط الحديد العلوي في الكابولي انهيار إنشائي ينتظر حِملًا، ويصير غير
مرئي بمجرد بدء الصب. وتُخطَّط مسارات الحركة حتى لا يدوس أحد الشبكة العلوية.

الصدأ والتخزين. الصدأ السطحي الخفيف طبيعي ومقبول عمومًا بل يحسّن التماسك. أما
المتقشر أو المنقّر أو المنفصل فغير مقبول. خزّن الأسياخ بعيدًا عن الأرض وعن
الكلوريدات وأي مصدر ملوحة. والتلوث بالزيت أو الطين أو مركّبات المعالجة يكسر
التماسك ويجب تنظيفه قبل الصب.

محركات التكلفة. سعر الطن جزء من الصورة فقط. فالهدر الناتج عن جداول ثني رديئة،
وقوائم قص تتجاهل الأطوال القياسية، والتفصيل المفرط الذي يخلق تزاحمًا، وأعمال
الإصلاح بسبب حديد في غير موضعه — كل ذلك يتجاوز غالبًا فرق السعر بين الموردين.
وجدول ثني الحديد الذي يعدّه من لن ينفّذه هو منبع كثير من هذا الهدر.

التفتيش. تركيب الحديد نقطة توقف كلاسيكية: فبمجرد بدء الصب ينتهي التفتيش إلى
الأبد. راجع القطر والتباعد والعدد والوصلات والغطاء والنظافة ومواضع الفتحات
وأشاير الأدوار مقابل الرسم والجدول، وسجّل ذلك بصور مرتبطة بمحاور المبنى.

الأخطاء المتكررة. استبدال رتبة الحديد على أساس السعر. استخدام الأحجار كفواصل.
دهس الحديد العلوي. تجميع الوصلات في قطاع واحد. افتراض الغطاء من مشروع آخر. إغفال
الأشاير أو وضعها في غير موضعها. الصب قبل التفتيش لأن السيارة وصلت.`,
  },
  {
    knowledgeId: 'mep-coordination',
    domain: 28,
    subcategory: 'MEP coordination and services installation',
    topic: 'Why MEP services clash, and how coordination actually prevents it',
    keywords: ['mep', 'services', 'hvac', 'ducting', 'chilled water', 'electrical containment', 'plumbing', 'drainage', 'clash detection', 'builders work', 'coordination drawing', 'ceiling void', 'كهروميكانيك', 'تكييف', 'دكت', 'سباكة', 'صرف', 'تعارض', 'تنسيق', 'أسقف مستعارة'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard MEP coordination and site practice, synthesised',
    reviewDate: '2027-06-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['qaqc-inspection-regime', 'handover-and-commissioning'],
    en: `MEP clashes are not an installation problem. They are a sequencing and
coordination problem that becomes visible during installation, which is why
resolving them on site is always the most expensive place to do it.

WHY THE VOID IS THE BATTLEGROUND. Ductwork, chilled and domestic water,
drainage, cable containment, fire protection and structure all compete for the
same ceiling space, and only one of them is governed by gravity. DRAINAGE HAS TO
FALL, so it takes precedence in the void and everything else routes around it -
a coordination sequence that puts small services first and then discovers the
drain cannot achieve its gradient has to be redone entirely. After drainage,
large ducts, then pipework, then containment, then the things that bend.

COORDINATION DRAWINGS, NOT SHOP DRAWINGS EACH. The point is a single composite
that every trade signs, showing levels and offsets, not four separate layouts
that each work in isolation. Where a model exists, clash detection is genuinely
valuable - but only if someone owns the resolution of each clash and the model
reflects what is actually being installed. An out-of-date model produces
confident, wrong coordination.

BUILDERS' WORK AND PENETRATIONS. Openings through structure must be agreed with
the structural designer BEFORE the pour. Coring a slab afterwards to fix a
missed penetration risks the reinforcement that scan surveys are supposed to
avoid, and adds fire-stopping and waterproofing complications that were never
detailed. A missed sleeve is one of the most common and most avoidable sources
of structural remedial work.

FIRE STOPPING is where coordination failures become compliance failures. Every
penetration through a fire-rated element must be sealed with a system tested for
THAT construction and THAT service type, installed as tested. Mixed
services through one opening, foam used where a collar was required, and
penetrations formed after the barrier was signed off are the recurring findings
- and they surface at handover, when the ceiling is closed and the inspector is
standing under it.

ACCESS AND MAINTAINABILITY. Valves, dampers, filters, junction boxes and
cleaning eyes must be reachable after the ceiling closes. A design that is
technically coordinated but leaves a valve above a fixed plasterboard ceiling
has moved a maintenance cost into the building's whole life. Access panels are
coordinated at the same time as the services, not scattered afterwards.

TESTING BEFORE CONCEALMENT. Pressure tests, continuity, insulation resistance
and drainage falls all get verified BEFORE anything is covered. This is the
single most valuable hold point in the trade and the one most often waived for
programme, which is why leaks are so often found in finished ceilings.

COST DRIVERS. Rework from clashes, out-of-sequence working, oversized plant
chosen because loads were never recalculated after the layout changed, and long
runs created by late plant-room positioning. Cheap containment and cheap valves
show up as maintenance cost rather than capital cost, which is why comparing
MEP tenders on headline price alone is unreliable.

THE MISTAKES THAT RECUR. Coordinating without the drainage falls. Signing a
composite nobody checked against the structure. Closing ceilings before testing.
Fire-stopping treated as a finishing activity. Access panels added last.
Commissioning left until the end, with no time to correct what it finds.`,
    ar: `تعارضات الأعمال الكهروميكانيكية ليست مشكلة تركيب، بل مشكلة تتابع وتنسيق
تظهر أثناء التركيب — ولهذا فإن حلها في الموقع هو دائمًا أغلى مكان لحلها.

لماذا فراغ السقف هو ساحة المعركة. تتنافس مجاري الهواء ومواسير المياه المبردة
والعذبة والصرف وحوامل الكابلات وأنظمة الحريق والعناصر الإنشائية على الحيز نفسه،
وواحد منها فقط محكوم بالجاذبية. فالصرف يجب أن ينحدر، ومن ثم له الأولوية في
الفراغ ويلتف حوله كل ما عداه؛ وأي تنسيق يبدأ بالخدمات الصغيرة ثم يكتشف أن ماسورة
الصرف لا تحقق ميلها يجب أن يُعاد من أوله. وبعد الصرف تأتي المجاري الكبيرة، ثم
المواسير، ثم الحوامل، ثم ما يمكن ثنيه.

رسومات تنسيق واحدة لا رسومات ورشة منفصلة. المطلوب لوحة مركّبة واحدة يوقّعها كل
تخصص وتبيّن المناسيب والإزاحات، لا أربع لوحات يعمل كل منها بمعزل. وحين يوجد
نموذج، يكون كشف التعارضات مفيدًا فعلًا — بشرط أن يملك أحدهم مسؤولية حل كل تعارض
وأن يعكس النموذج ما يُركَّب بالفعل. فالنموذج القديم ينتج تنسيقًا واثقًا وخاطئًا.

الأعمال المدنية المصاحبة والاختراقات. يجب الاتفاق على الفتحات في العناصر
الإنشائية مع المصمم الإنشائي قبل الصب. أما الحفر اللاحق في البلاطة لتدارك اختراق
منسي فيهدد التسليح الذي يفترض أن تتجنبه أعمال المسح، ويضيف تعقيدات في مانع
الحريق والعزل لم تُفصَّل أصلًا. وإغفال جلبة اختراق من أشيع أسباب الإصلاحات
الإنشائية وأكثرها قابلية للتفادي.

مانع انتشار الحريق هو حيث يتحول إخفاق التنسيق إلى إخفاق في المطابقة. فكل اختراق
لعنصر مقاوم للحريق يجب أن يُغلق بنظام مختبَر لذلك النوع من الإنشاء ولذلك النوع من
الخدمة، ويُركَّب كما اختُبر. أما خلط الخدمات في فتحة واحدة، واستخدام الرغوة حيث
يلزم طوق، وإحداث اختراقات بعد اعتماد الحاجز — فهي الملاحظات المتكررة، وتظهر عند
التسليم حين يكون السقف مغلقًا والمفتش واقفًا تحته.

الوصول وقابلية الصيانة. يجب أن تظل المحابس والدامبرات والفلاتر وعلب التوصيل
وفتحات التسليك في متناول اليد بعد إغلاق السقف. والتصميم المنسّق فنيًا الذي يترك
محبسًا فوق سقف جبسي ثابت قد نقل تكلفة صيانة إلى عمر المبنى كله. وتُنسَّق فتحات
الخدمة مع الخدمات نفسها لا تُوزَّع بعدها.

الاختبار قبل الإخفاء. اختبارات الضغط والاستمرارية ومقاومة العزل وميول الصرف
تُعتمد جميعًا قبل تغطية أي شيء. وهذه أثمن نقطة توقف في هذا التخصص وأكثرها
تنازلًا عنها حفاظًا على البرنامج، ولهذا كثيرًا ما تُكتشف التسريبات في أسقف
منتهية.

محركات التكلفة. إعادة العمل بسبب التعارضات، والعمل خارج التتابع، ومعدات مبالغ في
حجمها لأن الأحمال لم يُعَد حسابها بعد تغيير التوزيع، والمسارات الطويلة الناتجة عن
تحديد متأخر لموقع غرفة المعدات. أما الحوامل والمحابس الرخيصة فتظهر كتكلفة صيانة
لا كتكلفة رأسمالية، ولهذا فإن مقارنة عطاءات الأعمال الكهروميكانيكية بالسعر
الإجمالي وحده غير موثوقة.

الأخطاء المتكررة. التنسيق دون ميول الصرف. اعتماد لوحة مركّبة لم يراجعها أحد
مقابل الإنشائي. إغلاق الأسقف قبل الاختبار. اعتبار مانع الحريق نشاط تشطيب. إضافة
فتحات الخدمة في النهاية. تأجيل التشغيل التجريبي إلى الآخر بلا وقت لتصحيح ما
يكشفه.`,
  },
  {
    knowledgeId: 'site-safety-fundamentals',
    domain: 50,
    subcategory: 'Construction safety management',
    topic: 'What actually kills people on construction sites, and what prevents it',
    keywords: ['safety', 'hse', 'ppe', 'scaffold', 'fall protection', 'excavation', 'confined space', 'permit to work', 'lifting', 'toolbox talk', 'risk assessment', 'method statement', 'سلامة', 'مهمات وقاية', 'سقالات', 'حفر', 'أماكن مغلقة', 'تصريح عمل', 'رفع', 'تقييم مخاطر'],
    jurisdiction: 'GLOBAL', language: 'bilingual',
    authorityLevel: 6, sourceType: 'synthesised',
    sourceName: 'Standard construction health and safety practice, synthesised',
    reviewDate: '2027-06-01', status: 'current', version: '1.0',
    buildhubSpecific: false, dynamic: false,
    relatedTopics: ['qaqc-inspection-regime', 'mep-coordination'],
    en: `Construction fatalities concentrate in a small number of activities, and
they repeat. Falls from height, being struck by moving plant or falling
material, trench collapse, electrocution, and confined-space asphyxiation
account for the large majority. A safety programme that is not organised around
those is decorative.

THE HIERARCHY OF CONTROL is the whole discipline in one idea, and it is ordered
by how much it depends on human behaviour. ELIMINATE the hazard - design out the
work at height. SUBSTITUTE something less dangerous. ENGINEER a control -
edge protection, a guard, shoring. ADMINISTRATE - permits, sequences, training.
And last, PPE. Programmes that start at PPE have skipped every control that
works when someone is tired, rushed or new, which is when incidents happen.
A harness is what remains after the guardrail was not installed.

WORK AT HEIGHT. Edge protection before the work, not after the first near miss.
Scaffolds erected and altered only by competent people, inspected before use and
at intervals, and tagged so the person about to climb can see its status.
Openings covered and MARKED - an uncovered riser is invisible from above once
material is stacked around it. Ladders for access, not as a working platform.

EXCAVATIONS collapse without warning, and a cubic metre of soil weighs more than
a person can survive. Support, batter or bench any excavation deep enough to
bury someone; keep spoil and plant back from the edge, because surcharge is what
turns a stable face into a failed one. Buried-service drawings are a starting
point, not the truth: scan, then hand-dig to prove. Access and egress within a
short distance of any working position.

LIFTING. A lift plan for anything non-routine, a competent appointed person,
certified gear inspected before use, and exclusion zones that are actually
enforced rather than drawn. Nobody under a suspended load, ever - the most
common lifting fatality is somebody walking through a zone that existed only on
paper.

ELECTRICAL. Isolation and lock-off before work, proved dead at the point of
work with a tester that is itself proved. Temporary supplies through protective
devices, inspected regularly, with cables routed out of traffic and away from
water. Overhead lines treated as live at all times, with plant movements planned
around them.

CONFINED SPACES kill rescuers as often as workers, because the atmosphere that
disabled the first person is still there when the second arrives. Permit, gas
test before AND during, forced ventilation, continuous communication, and a
rescue plan that does not consist of somebody climbing in.

PERMITS TO WORK exist to force a conversation between people whose activities
would otherwise collide - hot work above a solvent store, isolation while
someone else is testing. A permit signed at a desk without a site check is worse
than no permit, because it creates a record suggesting the check happened.

WHAT MAKES IT WORK. Inductions that are specific to this site. Toolbox talks
about today's actual task. Supervisors with authority to stop work, and an
organisation where stopping is not punished. Incident AND NEAR-MISS reporting
that is acted on - near misses are the free lesson, and a site reporting none is
not safe, it is silent.

COST. Safety is cheap compared with an incident, and the arithmetic is not the
argument that persuades anyone; what persuades is that the same discipline that
prevents incidents - planning, sequence, competence, inspection - is what
delivers on programme.

THE MISTAKES THAT RECUR. Starting the hierarchy at PPE. Scaffold altered by
whoever was nearest. Spoil at the trench edge. Exclusion zones that people walk
through. Permits signed remotely. A near-miss book with nothing in it.`,
    ar: `تتركز الوفيات في مواقع الإنشاء في عدد صغير من الأنشطة، وهي تتكرر. فالسقوط
من علوٍّ، والاصطدام بمعدات متحركة أو بمواد ساقطة، وانهيار الحفر، والصعق الكهربائي،
والاختناق في الأماكن المغلقة تمثل الغالبية العظمى. وأي برنامج سلامة لا يُبنى حول
هذه المخاطر برنامج شكلي.

تدرج الضبط هو التخصص كله في فكرة واحدة، وهو مرتب بحسب مدى اعتماده على السلوك
البشري. أزل الخطر: صمّم بحيث ينتفي العمل على ارتفاع. استبدل بما هو أقل خطرًا.
اضبط هندسيًا: حماية الحواف، حواجز، دعم الحفر. ثم اضبط إداريًا: تصاريح وتتابع
وتدريب. وأخيرًا مهمات الوقاية الشخصية. والبرامج التي تبدأ من مهمات الوقاية تكون
قد تخطّت كل ضابط يعمل حين يكون العامل متعبًا أو مستعجلًا أو جديدًا، وهي بالضبط
لحظة وقوع الحوادث. فحزام الأمان هو ما يتبقى بعد أن لم يُركَّب حاجز الحافة.

العمل على ارتفاع. حماية الحواف قبل العمل لا بعد أول حادث وشيك. وتُقام السقالات
وتُعدَّل بواسطة أكفاء فقط، وتُفحص قبل الاستخدام وعلى فترات، وتُوسم ببطاقة يرى
فيها من سيصعد حالتها. وتُغطى الفتحات وتُعلَّم؛ فالفتحة المكشوفة غير مرئية من أعلى
بمجرد تكديس المواد حولها. والسلالم للوصول لا كمنصة عمل.

الحفر ينهار بلا إنذار، والمتر المكعب من التربة أثقل مما ينجو منه إنسان. ادعم أي
حفر عميق بما يكفي لدفن شخص أو خفّف ميوله أو درّجه؛ وأبعد الأتربة والمعدات عن
الحافة، فالحمل الإضافي هو ما يحوّل جانبًا مستقرًا إلى منهار. ورسومات الخدمات
المدفونة نقطة بداية لا حقيقة: امسح ثم احفر يدويًا للإثبات. واجعل مسالك الدخول
والخروج قريبة من أي موضع عمل.

الرفع. خطة رفع لكل عملية غير روتينية، وشخص معتمد كفء، ومعدات رفع سارية الشهادة
تُفحص قبل الاستخدام، ومناطق حظر تُفرض فعلًا لا تُرسم فقط. ولا أحد تحت حمل معلق
أبدًا؛ فأشيع وفيات الرفع هي شخص يعبر منطقة لم تكن موجودة إلا على الورق.

الكهرباء. عزل وقفل قبل العمل، وإثبات انعدام الجهد عند نقطة العمل بجهاز يُثبَت هو
نفسه. والتغذية المؤقتة عبر أجهزة حماية تُفحص دوريًا، بكابلات بعيدة عن الحركة وعن
المياه. وتُعامل الخطوط الهوائية على أنها مكهربة دائمًا، وتُخطَّط حركة المعدات
حولها.

الأماكن المغلقة تقتل المنقذين بقدر ما تقتل العاملين، لأن الجو الذي أفقد الأول
وعيه لا يزال موجودًا حين يصل الثاني. تصريح، وقياس للغازات قبل الدخول وأثناءه،
وتهوية قسرية، واتصال مستمر، وخطة إنقاذ لا تقوم على نزول شخص آخر.

تصاريح العمل موجودة لفرض حوار بين أشخاص كانت أنشطتهم ستتصادم — أعمال ساخنة فوق
مخزن مذيبات، أو عزل بينما يختبر آخر. والتصريح الذي يُوقَّع على مكتب دون معاينة
أسوأ من عدم وجود تصريح، لأنه ينشئ سجلًا يوحي بأن المعاينة تمت.

ما الذي يجعل ذلك ناجحًا. تعريف تمهيدي خاص بهذا الموقع تحديدًا. ولقاءات سلامة
قصيرة عن مهمة اليوم الفعلية. ومشرفون يملكون صلاحية إيقاف العمل، ومنظمة لا
تُعاقب على الإيقاف. والإبلاغ عن الحوادث والحوادث الوشيكة مع التصرف بناءً عليه؛
فالحادث الوشيك درس مجاني، والموقع الذي لا يبلّغ عن أي منها ليس آمنًا بل صامت.

التكلفة. السلامة رخيصة مقارنة بحادث، وليست الحسبة هي ما يقنع أحدًا؛ الذي يقنع أن
الانضباط نفسه الذي يمنع الحوادث — التخطيط والتتابع والكفاءة والتفتيش — هو ما
يسلّم المشروع في موعده.

الأخطاء المتكررة. بدء التدرج من مهمات الوقاية. تعديل السقالة بواسطة أقرب موجود.
ترك الأتربة على حافة الحفر. مناطق حظر يعبرها الناس. تصاريح تُوقَّع عن بُعد. دفتر
حوادث وشيكة خالٍ.`,
  },
];
