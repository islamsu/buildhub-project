import { Link } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, Bookmark, ClipboardList, HardHat,
  MessagesSquare, Scale, Search,
} from 'lucide-react';

/**
 * ── THE SOURCING JOURNEY, NOT ANOTHER FEATURE WALL ──────────────────────
 *
 * §89 item 19: the homepage must communicate the CONNECTED BuildHub
 * proposition - discover, shortlist, request quotations, compare,
 * collaborate, build - and "visibly connect buyer, supplier, marketplace and
 * project workflows rather than become another feature-card wall".
 *
 * WHAT THIS REPLACED, and why it was not enough. The page carried a
 * six-card "Features" grid and a four-card "Four Steps to Success" grid.
 * Between them they listed capabilities twice and connected none of them:
 * a reader learned that BuildHub HAS an RFQ system, not that posting one
 * puts their requirement in front of matching suppliers and brings back
 * comparable prices. Two walls of equal cards is the shape §73 names.
 *
 * ── THE ONE IDEA THIS SECTION CARRIES ──────────────────────────────────
 *
 * Every stage states BOTH SIDES: what the buyer does, and what the supplier
 * then sees. That is the actual product - CLAUDE.md §6's "buyer action must
 * become supplier reality" - and it is the thing a list of features cannot
 * say. It is also why the stages are rendered as a numbered CHAIN rather
 * than a grid: the order is the argument.
 *
 * ── NO FABRICATED PROOF (§75) ──────────────────────────────────────────
 *
 * No counts, no customer logos, no testimonials, no "trusted by" figures.
 * Every stage links to the real destination, so the claim is checkable by
 * following it rather than by believing a number.
 */

type Stage = {
  icon: typeof Search;
  href: string;
  testid: string;
  en: { title: string; buyer: string; supplier: string };
  ar: { title: string; buyer: string; supplier: string };
};

const STAGES: Stage[] = [
  {
    icon: Search, href: '/marketplace', testid: 'discover',
    en: {
      title: 'Discover and source',
      buyer: 'Search verified suppliers, products and professionals by category, specification and location.',
      supplier: 'Your published catalogue and storefront are what a buyer finds.',
    },
    ar: {
      title: 'ابحث واستكشف',
      buyer: 'ابحث عن موردين ومنتجات ومحترفين موثّقين حسب الفئة والمواصفات والموقع.',
      supplier: 'كتالوجك المنشور وواجهتك هما ما يجده المشتري.',
    },
  },
  {
    icon: Bookmark, href: '/saved', testid: 'shortlist',
    en: {
      title: 'Shortlist what fits',
      buyer: 'Set suppliers and products aside and compare them over days, not one session.',
      supplier: 'Saving is private — a supplier is never told they were shortlisted.',
    },
    ar: {
      title: 'اختر قائمتك المختصرة',
      buyer: 'ضع الموردين والمنتجات جانباً وقارن بينها على مدى أيام، لا جلسة واحدة.',
      supplier: 'الحفظ خاص — لا يُبلَّغ المورد بأنه ضمن قائمتك.',
    },
  },
  {
    icon: ClipboardList, href: '/rfq', testid: 'rfq',
    en: {
      title: 'Request quotations',
      buyer: 'Post your requirement once, with quantities, drawings and a deadline.',
      supplier: 'It reaches suppliers whose declared categories match, and the ones you invited.',
    },
    ar: {
      title: 'اطلب عروض الأسعار',
      buyer: 'انشر متطلبك مرة واحدة، بالكميات والمخططات وموعد التسليم.',
      supplier: 'يصل إلى الموردين المطابقين لفئاتهم المعلنة، وإلى من دعوتهم.',
    },
  },
  {
    icon: Scale, href: '/rfq', testid: 'compare',
    en: {
      title: 'Compare the offers',
      buyer: 'Price, timeline, warranty and documents side by side — every bid in the same currency as your request.',
      supplier: 'Your quotation is read against the brief you were given, not a different one.',
    },
    ar: {
      title: 'قارن العروض',
      buyer: 'السعر والمدة والضمان والمستندات جنباً إلى جنب — كل عرض بعملة طلبك نفسها.',
      supplier: 'يُقرأ عرضك مقابل نفس المتطلب الذي وصلك، لا غيره.',
    },
  },
  {
    icon: MessagesSquare, href: '/messages', testid: 'collaborate',
    en: {
      title: 'Agree the detail',
      buyer: 'Ask questions, exchange documents and revise before you commit.',
      supplier: 'Revise a quotation and the buyer sees the change, with the earlier version kept.',
    },
    ar: {
      title: 'اتفقوا على التفاصيل',
      buyer: 'اسأل، وتبادل المستندات، وراجِع قبل الالتزام.',
      supplier: 'عدِّل عرضك فيرى المشتري التغيير، مع حفظ النسخة السابقة.',
    },
  },
  {
    /*
     * `/dashboard`, NOT `/projects`.
     *
     * The first version pointed at `/projects`, which has no route: only
     * `/projects/:id` is registered, so the final promise on the homepage
     * landed on "Page Not Found". The SPA answers 200 for every path, so
     * curl could not see it - only following the link in a browser could,
     * which is why the probe walks every destination rather than checking
     * that the hrefs merely exist.
     *
     * `/dashboard` is where a buyer's projects actually live, and it is the
     * same destination the signed-in navigation uses for "Projects".
     */
    icon: HardHat, href: '/dashboard', testid: 'build',
    en: {
      title: 'Build and manage',
      buyer: 'Carry the accepted quotation into a project with expenses, documents and milestones.',
      supplier: 'The work, the people and the record stay in one place afterwards.',
    },
    ar: {
      title: 'نفّذ وأدر',
      buyer: 'حوّل العرض المقبول إلى مشروع بمصروفاته ومستنداته ومراحله.',
      supplier: 'يبقى العمل والأطراف والسجل في مكان واحد بعد ذلك.',
    },
  },
];

export default function SourcingJourney() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  return (
    <section className="border-y bg-muted/20 py-20" data-testid="home-journey">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary" className="mb-4 px-4 py-1 text-sm">
            {ar ? 'كيف تعمل BuildHub' : 'How BuildHub works'}
          </Badge>
          <h2 className="text-3xl font-bold sm:text-4xl">
            {ar ? 'من البحث إلى التنفيذ، في مسار واحد' : 'From sourcing to site, in one connected path'}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {ar
              ? 'كل خطوة يقوم بها المشتري تصل إلى الطرف الآخر. هذه ليست قائمة مزايا منفصلة.'
              : 'Every step a buyer takes reaches the other side. These are not separate features.'}
          </p>
        </div>

        {/* A NUMBERED CHAIN, not a grid: the order is the argument. Rendered
            as an ordered list so it is a sequence to a screen reader too. */}
        <ol className="mx-auto mt-12 max-w-4xl space-y-3">
          {STAGES.map((stage, index) => {
            const copy = ar ? stage.ar : stage.en;
            const Icon = stage.icon;
            return (
              <li key={stage.testid}>
                <Link
                  href={stage.href}
                  className="group flex gap-4 rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 sm:p-5"
                  data-testid={`journey-${stage.testid}`}
                >
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    {/* The connector, drawn only between stages - the last
                        one ends the chain rather than trailing into nothing. */}
                    {index < STAGES.length - 1 && (
                      <span className="hidden w-px flex-1 bg-border sm:block" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <h3 className="font-semibold group-hover:underline">{copy.title}</h3>
                      <ArrowRight className={`h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 ${ar ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.buyer}</p>
                    {/* THE OTHER SIDE. This line is the reason the section
                        exists: it is what a feature list cannot say. */}
                    <p className="mt-1.5 text-sm text-foreground/70" data-testid={`journey-${stage.testid}-counterpart`}>
                      <span className="font-medium">{ar ? 'للمورّد: ' : 'For the supplier: '}</span>
                      {copy.supplier}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
