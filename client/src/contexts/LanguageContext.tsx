import React, { createContext, useContext, useEffect, useState } from 'react';

export type Language = 'en' | 'ar';

interface LanguageContextValue {
  lang: Language;
  dir: 'ltr' | 'rtl';
  setLang: (l: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Nav
    'nav.home': 'Home',
    'nav.marketplace': 'Marketplace',
    'nav.projects': 'Projects',
    'nav.rfq': 'Get Quotes',
    'nav.signin': 'Sign In',
    'nav.signup': 'Get Started',
    'nav.dashboard': 'Dashboard',
    'nav.logout': 'Sign Out',
    // Hero
    'hero.badge': 'AI-Powered Construction OS',
    'hero.title': 'Build Smarter. Connect Everyone.',
    'hero.subtitle': 'BuildHub connects homeowners, contractors, engineers, architects, and suppliers in one intelligent ecosystem — from planning to completion.',
    'hero.cta.primary': 'Start Your Project',
    'hero.cta.secondary': 'Explore Marketplace',
    // Features
    'features.title': 'Everything You Need to Build',
    'features.subtitle': 'One platform for every stage of your construction journey',
    'features.marketplace.title': 'Smart Marketplace',
    'features.marketplace.desc': 'Browse thousands of products across materials, furniture, HVAC, and more with full specs and verified reviews.',
    'features.rfq.title': 'RFQ Engine',
    'features.rfq.desc': 'Post your requirements and receive competitive quotations from verified providers, then compare side by side.',
    'features.ai.title': 'AI Assistant Suite',
    'features.ai.desc': 'Get instant cost estimates, quantity surveys, material recommendations, and risk assessments powered by AI.',
    'features.pm.title': 'Project Management',
    'features.pm.desc': 'Track timelines, milestones, budgets, and team tasks in a unified workspace designed for construction.',
    'features.matching.title': 'Smart Matching',
    'features.matching.desc': 'Our algorithm surfaces the best-fit contractors and suppliers based on location, ratings, and your budget.',
    'features.messaging.title': 'Real-time Collaboration',
    'features.messaging.desc': 'Chat, share files, exchange quotations, and get notified instantly — all within the platform.',
    // User types
    'roles.title': 'Built for Every Stakeholder',
    'roles.homeowner': 'Homeowner',
    'roles.homeowner.desc': 'Create projects, manage budgets, hire professionals, and track progress from one dashboard.',
    'roles.contractor': 'Contractor',
    'roles.contractor.desc': 'Receive RFQs, submit quotations, manage your team, and grow your business.',
    'roles.engineer': 'Engineer',
    'roles.engineer.desc': 'Showcase your expertise, collaborate on projects, and manage your portfolio.',
    'roles.architect': 'Architect',
    'roles.architect.desc': 'Present your designs, connect with clients, and manage project documentation.',
    'roles.supplier': 'Supplier',
    'roles.supplier.desc': 'List your products, receive orders, and reach thousands of construction professionals.',
    // Auth
    'auth.signin': 'Sign In',
    'auth.signup': 'Create Account',
    'auth.role.select': 'I am a...',
    'auth.email': 'Email Address',
    'auth.password': 'Password',
    'auth.name': 'Full Name',
    'auth.phone': 'Phone Number',
    'auth.otp': 'Verification Code',
    'auth.otp.sent': 'We sent a 6-digit code to your phone',
    'auth.continue': 'Continue',
    'auth.have.account': 'Already have an account?',
    'auth.no.account': "Don't have an account?",
    // Dashboard
    'dash.overview': 'Overview',
    'dash.projects': 'My Projects',
    'dash.marketplace': 'Marketplace',
    'dash.rfq': 'Quotations',
    'dash.messages': 'Messages',
    'dash.notifications': 'Notifications',
    'dash.reviews': 'Reviews',
    'dash.settings': 'Settings',
    'dash.ai': 'AI Assistant',
    // Projects
    'project.new': 'New Project',
    'project.name': 'Project Name',
    'project.type': 'Project Type',
    'project.budget': 'Total Budget',
    'project.location': 'Location',
    'project.status': 'Status',
    'project.progress': 'Progress',
    'project.milestones': 'Milestones',
    'project.documents': 'Documents',
    'project.team': 'Team',
    // Marketplace
    'market.search': 'Search products, brands, categories...',
    'market.filter': 'Filter',
    'market.sort': 'Sort by',
    'market.add_to_rfq': 'Add to RFQ',
    'market.view': 'View Details',
    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.view': 'View',
    'common.submit': 'Submit',
    'common.loading': 'Loading...',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.all': 'All',
    'common.status.active': 'Active',
    'common.status.pending': 'Pending',
    'common.status.completed': 'Completed',
    'common.status.cancelled': 'Cancelled',
    'common.coming_soon': 'Coming Soon',
  },
  ar: {
    // Nav
    'nav.home': 'الرئيسية',
    'nav.marketplace': 'السوق',
    'nav.projects': 'المشاريع',
    'nav.rfq': 'طلب عروض',
    'nav.signin': 'تسجيل الدخول',
    'nav.signup': 'ابدأ الآن',
    'nav.dashboard': 'لوحة التحكم',
    'nav.logout': 'تسجيل الخروج',
    // Hero
    'hero.badge': 'نظام تشغيل البناء بالذكاء الاصطناعي',
    'hero.title': 'ابنِ بذكاء. اربط الجميع.',
    'hero.subtitle': 'BuildHub يربط أصحاب المنازل والمقاولين والمهندسين والمعماريين والموردين في منظومة ذكية واحدة — من التخطيط حتى الإنجاز.',
    'hero.cta.primary': 'ابدأ مشروعك',
    'hero.cta.secondary': 'استكشف السوق',
    // Features
    'features.title': 'كل ما تحتاجه للبناء',
    'features.subtitle': 'منصة واحدة لكل مرحلة من رحلة البناء',
    'features.marketplace.title': 'سوق ذكي',
    'features.marketplace.desc': 'تصفح آلاف المنتجات من مواد البناء والأثاث وأنظمة التكييف وغيرها مع مواصفات كاملة وتقييمات موثقة.',
    'features.rfq.title': 'محرك طلبات العروض',
    'features.rfq.desc': 'انشر متطلباتك واحصل على عروض تنافسية من مزودين موثقين، ثم قارن بينها جنباً إلى جنب.',
    'features.ai.title': 'مجموعة مساعد الذكاء الاصطناعي',
    'features.ai.desc': 'احصل على تقديرات تكلفة فورية وكميات ومواد موصى بها وتقييمات مخاطر مدعومة بالذكاء الاصطناعي.',
    'features.pm.title': 'إدارة المشاريع',
    'features.pm.desc': 'تتبع الجداول الزمنية والمعالم والميزانيات ومهام الفريق في مساحة عمل موحدة مصممة للبناء.',
    'features.matching.title': 'المطابقة الذكية',
    'features.matching.desc': 'تعرض خوارزميتنا أفضل المقاولين والموردين بناءً على الموقع والتقييمات وميزانيتك.',
    'features.messaging.title': 'التعاون الفوري',
    'features.messaging.desc': 'تحدث وشارك الملفات وتبادل العروض واحصل على إشعارات فورية — كل ذلك داخل المنصة.',
    // User types
    'roles.title': 'مبني لكل أصحاب المصلحة',
    'roles.homeowner': 'صاحب المنزل',
    'roles.homeowner.desc': 'أنشئ مشاريع وأدر الميزانيات واستأجر المحترفين وتتبع التقدم من لوحة تحكم واحدة.',
    'roles.contractor': 'المقاول',
    'roles.contractor.desc': 'استقبل طلبات العروض وقدم العطاءات وأدر فريقك وطوّر أعمالك.',
    'roles.engineer': 'المهندس',
    'roles.engineer.desc': 'اعرض خبرتك وتعاون في المشاريع وأدر محفظتك.',
    'roles.architect': 'المعماري',
    'roles.architect.desc': 'قدّم تصاميمك وتواصل مع العملاء وأدر وثائق المشروع.',
    'roles.supplier': 'المورد',
    'roles.supplier.desc': 'اعرض منتجاتك واستقبل الطلبات وتواصل مع آلاف المحترفين في البناء.',
    // Auth
    'auth.signin': 'تسجيل الدخول',
    'auth.signup': 'إنشاء حساب',
    'auth.role.select': 'أنا...',
    'auth.email': 'البريد الإلكتروني',
    'auth.password': 'كلمة المرور',
    'auth.name': 'الاسم الكامل',
    'auth.phone': 'رقم الهاتف',
    'auth.otp': 'رمز التحقق',
    'auth.otp.sent': 'أرسلنا رمزاً مكوناً من 6 أرقام إلى هاتفك',
    'auth.continue': 'متابعة',
    'auth.have.account': 'لديك حساب بالفعل؟',
    'auth.no.account': 'ليس لديك حساب؟',
    // Dashboard
    'dash.overview': 'نظرة عامة',
    'dash.projects': 'مشاريعي',
    'dash.marketplace': 'السوق',
    'dash.rfq': 'عروض الأسعار',
    'dash.messages': 'الرسائل',
    'dash.notifications': 'الإشعارات',
    'dash.reviews': 'التقييمات',
    'dash.settings': 'الإعدادات',
    'dash.ai': 'مساعد الذكاء الاصطناعي',
    // Projects
    'project.new': 'مشروع جديد',
    'project.name': 'اسم المشروع',
    'project.type': 'نوع المشروع',
    'project.budget': 'الميزانية الإجمالية',
    'project.location': 'الموقع',
    'project.status': 'الحالة',
    'project.progress': 'التقدم',
    'project.milestones': 'المعالم',
    'project.documents': 'الوثائق',
    'project.team': 'الفريق',
    // Marketplace
    'market.search': 'ابحث عن منتجات، علامات تجارية، فئات...',
    'market.filter': 'تصفية',
    'market.sort': 'ترتيب حسب',
    'market.add_to_rfq': 'أضف لطلب العرض',
    'market.view': 'عرض التفاصيل',
    // Common
    'common.save': 'حفظ',
    'common.cancel': 'إلغاء',
    'common.delete': 'حذف',
    'common.edit': 'تعديل',
    'common.view': 'عرض',
    'common.submit': 'إرسال',
    'common.loading': 'جاري التحميل...',
    'common.search': 'بحث',
    'common.filter': 'تصفية',
    'common.all': 'الكل',
    'common.status.active': 'نشط',
    'common.status.pending': 'قيد الانتظار',
    'common.status.completed': 'مكتمل',
    'common.status.cancelled': 'ملغي',
    'common.coming_soon': 'قريباً',
  },
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  dir: 'ltr',
  setLang: () => {},
  t: (k) => k,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    return (localStorage.getItem('buildhub_lang') as Language) || 'en';
  });

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const setLang = (l: Language) => {
    setLangState(l);
    localStorage.setItem('buildhub_lang', l);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.body.style.fontFamily = lang === 'ar' ? "'Cairo', sans-serif" : "'Inter', sans-serif";
  }, [lang, dir]);

  const t = (key: string): string => {
    return translations[lang][key] ?? translations['en'][key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
