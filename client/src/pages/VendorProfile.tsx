import { Link, useLocation, useParams } from 'wouter';
import Navbar from '@/components/Navbar';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import VendorReputation from '@/components/VendorReputation';
import { parseProductImages } from '@shared/productImages';
import { ArrowLeft, ArrowRight, BadgeCheck, Briefcase, Calendar, MapPin, MessageSquare, Package, Star, Store } from 'lucide-react';

function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function VendorProfile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const userId = Number(id);
  const { t, lang } = useLanguage();
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const ar = lang === 'ar';
  const BackIcon = ar ? ArrowRight : ArrowLeft;

  // Public vendor profile access currently requires sign-in (protectedProcedure) -
  // the safer of the two options Phase 4A.5 left as an open owner decision.
  // See BUILDHUB_PHASE4A61_VENDOR_PROFILE_IMPLEMENTATION.md for the unresolved
  // "should this be viewable while logged out" decision.
  const { data: profile, isLoading, error } = trpc.profile.getPublic.useQuery(
    { userId },
    { enabled: isAuthenticated && Number.isFinite(userId) && userId > 0, retry: false },
  );
  const { data: catalogue = [] } = trpc.marketplace.vendorProducts.useQuery(
    { vendorId: userId },
    { enabled: Number.isFinite(userId) && userId > 0 },
  );
  const { data: portfolio = [] } = trpc.portfolio.list.useQuery(
    { userId },
    { enabled: Number.isFinite(userId) && userId > 0 },
  );
  const isSelf = Boolean(user && (user as { id?: number }).id === userId);

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-background" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Navbar />
      <main className="container pt-24 pb-16 max-w-2xl">
        {/* "Back" went to the HOME PAGE. This page is reached from the
            marketplace hub, the vendors directory, a product's supplier line
            and an architect's own workspace - and from every one of them the
            control labelled Back landed somewhere the visitor had not been.
            history.back() when there is history to go back to, and the vendors
            directory when there is not (a bookmark, a shared link), because
            that is where this record lives - not the front page. */}
        <Button
          variant="ghost"
          className="mb-6 gap-2"
          data-testid="vendor-back"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) window.history.back();
            else navigate('/marketplace/vendors');
          }}
        >
          <BackIcon className="h-4 w-4" />{lang === 'ar' ? 'رجوع' : 'Back'}
        </Button>
        {children}
      </main>
    </div>
  );

  if (authLoading) return <Shell><div className="text-center py-16 text-muted-foreground">{t('common.loading')}</div></Shell>;

  if (!isAuthenticated) {
    return (
      <Shell>
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{lang === 'ar' ? 'يرجى تسجيل الدخول لعرض الملف الشخصي للمزود' : 'Please sign in to view this vendor profile'}</p>
          <Link href="/auth?mode=login"><Button className="mt-4">{lang === 'ar' ? 'تسجيل الدخول' : 'Sign in'}</Button></Link>
        </CardContent></Card>
      </Shell>
    );
  }

  if (isLoading) return <Shell><div className="text-center py-16 text-muted-foreground">{t('common.loading')}</div></Shell>;

  if (error || !profile) {
    return (
      <Shell>
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{t('profile.not_found')}</p>
        </CardContent></Card>
      </Shell>
    );
  }

  const roleLabel = profile.userRole ? profile.userRole.charAt(0).toUpperCase() + profile.userRole.slice(1).replace('_', ' ') : '';

  return (
    <Shell>
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-start gap-4">
            <Avatar className="size-16">
              {profile.avatar && <AvatarImage src={profile.avatar} alt={profile.name ?? ''} />}
              <AvatarFallback className="text-lg font-semibold">{initials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold truncate">{profile.name || '—'}</h1>
                {profile.verified && (
                  <Badge variant="secondary" className="gap-1"><BadgeCheck className="w-3.5 h-3.5" />{t('profile.verified_badge')}</Badge>
                )}
              </div>
              {roleLabel && <p className="text-sm text-muted-foreground capitalize">{roleLabel}</p>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-4 h-4 flex-shrink-0" /><span className="truncate">{profile.location || '—'}</span></div>
            <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="w-4 h-4 flex-shrink-0" /><span>{t('profile.member_since')} {new Date(profile.createdAt).getFullYear()}</span></div>
            <div className="flex items-center gap-2 text-muted-foreground"><Briefcase className="w-4 h-4 flex-shrink-0" /><span>{profile.completedProjects} {t('profile.completed_projects')}</span></div>
          </div>

          {/* ── THE COMPANY ──────────────────────────────────────────────
              Public tier: what a customer needs to CHOOSE. Rendered only when
              the vendor has actually filled something in - an empty card that
              says "Company: —" four times looks like a broken page, and
              inventing a company name from their personal name would be
              fabricating business data. */}
          {profile.company && Object.values(profile.company).some(Boolean) && (
            <div data-testid="vendor-company">
              <h2 className="text-sm font-semibold mb-2">{ar ? 'الشركة' : 'Company'}</h2>
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                {profile.company.companyName && (
                  <div data-testid="vendor-company-name">
                    <p className="text-xs text-muted-foreground">{ar ? 'الاسم التجاري' : 'Company name'}</p>
                    <p className="font-medium">{profile.company.companyName}</p>
                  </div>
                )}
                {profile.company.tradingName && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'الاسم القانوني / التجاري' : 'Legal / trading name'}</p>
                    <p className="font-medium">{profile.company.tradingName}</p>
                  </div>
                )}
                {(profile.company.city || profile.company.country) && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'الموقع' : 'Location'}</p>
                    <p className="font-medium">
                      {[profile.company.city, profile.company.country].filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
                {profile.company.website && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'الموقع الإلكتروني' : 'Website'}</p>
                    {/* rel=noopener because this URL is vendor-supplied. */}
                    <a
                      className="font-medium text-primary underline break-all"
                      href={profile.company.website}
                      target="_blank" rel="noopener noreferrer nofollow"
                      data-testid="vendor-company-website"
                    >{profile.company.website}</a>
                  </div>
                )}
              </div>
              {profile.company.companyDescription && (
                <p className="mt-3 text-sm text-muted-foreground leading-6 whitespace-pre-wrap">
                  {profile.company.companyDescription}
                </p>
              )}
              {profile.company.serviceCoverage && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">{ar ? 'مناطق الخدمة' : 'Service coverage'}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{profile.company.serviceCoverage}</p>
                </div>
              )}
              {profile.company.specialties && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">{ar ? 'التخصصات' : 'Specialties'}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{profile.company.specialties}</p>
                </div>
              )}
              {profile.company.businessHours && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">{ar ? 'ساعات العمل' : 'Business hours'}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{profile.company.businessHours}</p>
                </div>
              )}
              {profile.company.socialLinks && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">{ar ? 'روابط العمل' : 'Business links'}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{profile.company.socialLinks}</p>
                </div>
              )}
            </div>
          )}

          {/* ── THE PRIMARY CONTACT ──────────────────────────────────────
              Released only once the vendor has ENGAGED - they quoted for this
              customer, or they are on this customer's project.
              THE LOCKED STATE SAYS WHY. An unexplained blank reads as a vendor
              who left the field empty, which is a different fact and makes the
              product look broken rather than deliberate. */}
          {profile.primaryContact ? (
            <div data-testid="vendor-primary-contact">
              <h2 className="text-sm font-semibold mb-2">{ar ? 'جهة الاتصال الرئيسية' : 'Primary contact'}</h2>
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                {profile.primaryContact.primaryContactName && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'الاسم' : 'Name'}</p>
                    <p className="font-medium" data-testid="vendor-contact-name">
                      {profile.primaryContact.primaryContactName}
                      {profile.primaryContact.primaryContactPosition
                        ? ` · ${profile.primaryContact.primaryContactPosition}` : ''}
                    </p>
                  </div>
                )}
                {profile.primaryContact.primaryContactEmail && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'البريد الإلكتروني' : 'Email'}</p>
                    <p className="font-medium break-all">{profile.primaryContact.primaryContactEmail}</p>
                  </div>
                )}
                {profile.primaryContact.alternativeEmail && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'البريد البديل' : 'Alternative email'}</p>
                    <p className="font-medium break-all">{profile.primaryContact.alternativeEmail}</p>
                  </div>
                )}
                {(profile.primaryContact.primaryContactPhone || profile.primaryContact.primaryContactMobile) && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'الهاتف' : 'Phone'}</p>
                    <p className="font-medium">
                      {[profile.primaryContact.primaryContactPhone, profile.primaryContact.primaryContactMobile]
                        .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                )}
                {profile.primaryContact.addressLine && (
                  <div>
                    <p className="text-xs text-muted-foreground">{ar ? 'العنوان' : 'Address'}</p>
                    <p className="font-medium">{profile.primaryContact.addressLine}</p>
                  </div>
                )}
              </div>
            </div>
          ) : profile.company && (
            <div className="rounded-lg border border-dashed p-3" data-testid="vendor-contact-locked">
              <p className="text-sm text-muted-foreground">
                {ar
                  ? 'تظهر بيانات جهة الاتصال المباشرة بعد أن يتقدّم هذا المورّد بعرض سعر على أحد طلباتك أو ينضم إلى أحد مشاريعك.'
                  : 'Direct contact details appear once this vendor has quoted on one of your requests or joined one of your projects.'}
              </p>
            </div>
          )}

          {/* THE SERVICES THIS VENDOR DECLARED.
              From vendorCategories - the same list that decides which RFQs
              they are eligible for - so the page cannot advertise work the
              matching engine would not send them. */}
          {profile.categories.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">{t('vendor.services')}</h2>
              <div className="flex flex-wrap gap-1.5" data-testid="vendor-categories">
                {profile.categories.map(category => (
                  <Badge key={category} variant="secondary" className="font-normal">{category}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* PROVIDER PORTFOLIO. Real completed work the provider added; never
              fabricated, and absent when the provider has added none. */}
          {portfolio.length > 0 && (
            <div data-testid="vendor-portfolio">
              <h2 className="text-sm font-semibold mb-2">{t('provider.portfolio')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {portfolio.map(item => {
                  const images = parseProductImages(item.images);
                  return (
                    <div key={item.id} className="rounded-xl border p-3">
                      {images[0] && <img src={images[0]} alt="" className="mb-2 h-28 w-full rounded-md border object-cover" />}
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[item.category, item.location, item.completionYear != null ? String(item.completionYear) : null]
                          .filter(Boolean).join(' · ') || '—'}
                      </p>
                      {item.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap">{item.description}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold mb-1">{t('profile.bio_label')}</h2>
            {profile.bio ? (
              <p className="text-sm text-muted-foreground leading-6 whitespace-pre-wrap">{profile.bio}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">{t('profile.empty_bio')}</p>
            )}
          </div>

          {/* CONTACT.
              BuildHub operates exactly one contact route between a customer
              and a vendor: the in-platform thread. Phone and email are not
              part of the public profile in this codebase and this page does
              not become the first place they leak. The note says so, so nobody
              reads the absence of a phone number as missing data. */}
          <div className="border-t pt-4">
            <h2 className="text-sm font-semibold mb-2">{t('vendor.contact')}</h2>
            {isSelf ? (
              <p className="text-sm text-muted-foreground">{t('vendor.contact.self')}</p>
            ) : profile.contactChannel === 'message' ? (
              <>
                <Link href={`/messages?to=${userId}`}>
                  <Button className="gap-2" data-testid="vendor-contact">
                    <MessageSquare className="w-4 h-4" />{t('vendor.contact.cta')}
                  </Button>
                </Link>
                <p className="mt-2 text-xs text-muted-foreground">{t('vendor.contact.note')}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="vendor-contact-unavailable">{t('vendor.contact.unavailable')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* WHAT THEY SELL.
          Published rows only, from marketplace.vendorProducts. A supplier
          profile with a rating and no catalogue is not a vendor record. */}
      {catalogue.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Package className="w-4 h-4" /> {t('vendor.catalogue')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2" data-testid="vendor-catalogue">
              {catalogue.map(product => (
                <Link key={product.id} href={`/marketplace/products/${product.id}`}>
                  <div className="rounded-xl border p-3 hover:border-primary/40 transition-colors cursor-pointer">
                    <p className="font-medium text-sm truncate">{lang === 'ar' ? (product.nameAr || product.name) : product.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('common.egp')} {Number(product.price).toLocaleString()}{product.unit ? ` / ${product.unit}` : ''}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Star className="w-4 h-4" /> {t('reputation.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <VendorReputation userId={userId} />
        </CardContent>
      </Card>
    </Shell>
  );
}
