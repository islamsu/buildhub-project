/**
 * ── Settings: where the account lives, rather than the work (§10) ──────────
 *
 * BuildHub had no user-facing Settings page at all. `/admin/settings` existed
 * for administrators; everyone else's account configuration was scattered
 * through the workspace, permanently occupying space beside the RFQs and
 * quotations people actually come here to work on.
 *
 * NOTHING HERE IS REIMPLEMENTED. This page renders the SAME components the
 * workspace rendered - VendorProfileCard, VendorBilling, VendorServiceCategories
 * - so there is one implementation of each, one set of server calls, and no
 * chance of two copies drifting apart. Moving a card is a change of address,
 * not a rewrite.
 *
 * WHAT DELIBERATELY DID NOT MOVE, and why:
 *
 *   THE QUALIFIED-ENQUIRY INBOX stays in the workspace. §10 lists "Enquiries"
 *   among the things to move, but that inbox is not configuration - it is a
 *   supplier's leads, the thing they open the product to read. It is also the
 *   destination of the `?rfq=` deep link that notifications send, and burying a
 *   notification's target inside Settings would break the one journey the
 *   notification exists to complete. Service CATEGORIES - which categories you
 *   declare you serve - is configuration and did move.
 *
 *   REGISTRATION COMPLIANCE keeps its own page. `/compliance` is a document
 *   upload and review workflow with its own states, not a settings panel;
 *   Settings links to it rather than growing a second copy of the uploader.
 *
 * A SECTION A ROLE DOES NOT HAVE IS NAMED, NOT HIDDEN. A homeowner has no
 * service categories and no vendor plan. Rendering nothing would leave them
 * wondering whether the page failed to load, so each absent section says which
 * accounts it applies to.
 */

import { useEffect } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardLayout from '@/components/DashboardLayout';
import VendorProfileCard from '@/components/VendorProfileCard';
import VendorBilling from '@/components/VendorBilling';
import VendorCompanyProfile from '@/components/VendorCompanyProfile';
import VendorServiceCategories from '@/components/VendorServiceCategories';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UserRound, CreditCard, Tags, ClipboardCheck, ArrowRight } from 'lucide-react';

/** The roles that carry a vendor plan and declare service categories. */
const PROVIDER_ROLES = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'];

export default function SettingsPage() {
  const { lang, dir } = useLanguage();
  const ar = lang === 'ar';
  const { user, isAuthenticated, loading } = useAuth();
  const role = (user as { userRole?: string } | null)?.userRole ?? '';
  const isProvider = PROVIDER_ROLES.includes(role);

  /**
   * The hash lands on the section. The account menu links straight to
   * `#settings-billing`, and a browser will not scroll to an anchor that was
   * not in the DOM when the URL was first parsed - these sections arrive after
   * the auth query resolves.
   */
  useEffect(() => {
    if (loading || !window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, isProvider]);

  if (!loading && !isAuthenticated) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-lg py-16 text-center" dir={dir}>
          <h1 className="text-2xl font-bold">{ar ? 'الإعدادات' : 'Settings'}</h1>
          <p className="mt-2 text-muted-foreground">
            {ar ? 'سجّل الدخول لعرض إعدادات حسابك.' : 'Sign in to see your account settings.'}
          </p>
          <Link href="/auth?mode=login">
            <Button className="mt-4">{ar ? 'تسجيل الدخول' : 'Sign in'}</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8" dir={dir} data-testid="settings-page">
        <div>
          <h1 className="text-2xl font-bold">{ar ? 'الإعدادات' : 'Settings'}</h1>
          <p className="mt-1 text-muted-foreground">
            {ar
              ? 'ملفك، باقتك، وفئات الخدمة التي تعلن عنها. أما طلباتك وعروضك فمكانها مساحة العمل.'
              : 'Your profile, your plan, and the service categories you declare. Your requests and quotations stay in your workspace.'}
          </p>
        </div>

        {/* ── Profile: every role has one ───────────────────────────────── */}
        <Section
          id="settings-profile"
          icon={<UserRound className="h-5 w-5" />}
          title={ar ? 'الملف الشخصي' : 'Profile'}
        >
          <Card><CardContent className="pt-6"><VendorProfileCard /></CardContent></Card>
        </Section>

        {/* ── The company record: providers only ─────────────────────────── */}
        {/*
          Separate from Profile above, because they answer different questions.
          That card is the PERSON's account - name, bio, avatar. This is the
          COMPANY a customer contracts with, and its fields sit at three
          different visibility tiers which the form states on itself.
        */}
        <Section
          id="settings-company"
          icon={<UserRound className="h-5 w-5" />}
          title={ar ? 'بيانات الشركة' : 'Company details'}
        >
          {isProvider
            ? <Card><CardContent className="pt-6"><VendorCompanyProfile /></CardContent></Card>
            : <NotForThisAccount
                ar={ar}
                en="Company details apply to provider accounts — suppliers, contractors, engineers, architects and project managers."
                arabic="بيانات الشركة تخص حسابات مقدّمي الخدمة: الموردين والمقاولين والمهندسين والمعماريين ومديري المشاريع."
              />}
        </Section>

        {/* ── Plan & billing: providers only, and said so otherwise ──────── */}
        <Section
          id="settings-billing"
          icon={<CreditCard className="h-5 w-5" />}
          title={ar ? 'الباقة والفوترة' : 'Plan & billing'}
        >
          {isProvider
            ? <VendorBilling />
            : <NotForThisAccount
                ar={ar}
                en="Plans apply to provider accounts — suppliers, contractors, engineers, architects and project managers. Posting requests is free."
                arabic="الباقات تخص حسابات مقدّمي الخدمة: الموردين والمقاولين والمهندسين والمعماريين ومديري المشاريع. نشر الطلبات مجاني."
              />}
        </Section>

        {/* ── Service categories: providers only ────────────────────────── */}
        <Section
          id="settings-categories"
          icon={<Tags className="h-5 w-5" />}
          title={ar ? 'فئات الخدمة' : 'Service categories'}
        >
          {isProvider
            ? <VendorServiceCategories />
            : <NotForThisAccount
                ar={ar}
                en="Service categories are declared by provider accounts, so BuildHub knows which requests to route to them."
                arabic="فئات الخدمة يعلنها مقدّمو الخدمة حتى تعرف BuildHub أي الطلبات تُوجَّه إليهم."
              />}
        </Section>

        {/* ── Registration compliance: links out, never duplicated ──────── */}
        <Section
          id="settings-compliance"
          icon={<ClipboardCheck className="h-5 w-5" />}
          title={ar ? 'التحقق من التسجيل' : 'Registration compliance'}
        >
          {isProvider ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <p className="text-sm text-muted-foreground">
                  {ar
                    ? 'مستنداتك القانونية وحالة مراجعتها تُدار في صفحتها المخصّصة.'
                    : 'Your legal documents and their review status are managed on their own page.'}
                </p>
                <Link href="/compliance">
                  <Button variant="outline" className="gap-2" data-testid="settings-compliance-link">
                    {ar ? 'افتح المستندات' : 'Open documents'}
                    <ArrowRight className={`h-4 w-4 ${ar ? 'rotate-180' : ''}`} />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <NotForThisAccount
              ar={ar}
              en="Document review applies to provider accounts, before professional tools are activated."
              arabic="مراجعة المستندات تخص حسابات مقدّمي الخدمة قبل تفعيل أدوات المحترفين."
            />
          )}
        </Section>
      </div>
    </DashboardLayout>
  );
}

function Section({ id, icon, title, children }: {
  id: string; icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <section id={id} data-testid={id} className="scroll-mt-24">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Absent, and honest about why - not an empty card. */
function NotForThisAccount({ ar, en, arabic }: { ar: boolean; en: string; arabic: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground" data-testid="settings-not-applicable">
          {ar ? arabic : en}
        </p>
      </CardContent>
    </Card>
  );
}
