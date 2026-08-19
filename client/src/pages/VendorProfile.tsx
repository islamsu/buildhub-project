import { Link, useParams } from 'wouter';
import Navbar from '@/components/Navbar';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ArrowRight, BadgeCheck, Briefcase, Calendar, MapPin, Store } from 'lucide-react';

function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function VendorProfile() {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const { t, lang } = useLanguage();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;

  // Public vendor profile access currently requires sign-in (protectedProcedure) -
  // the safer of the two options Phase 4A.5 left as an open owner decision.
  // See BUILDHUB_PHASE4A61_VENDOR_PROFILE_IMPLEMENTATION.md for the unresolved
  // "should this be viewable while logged out" decision.
  const { data: profile, isLoading, error } = trpc.profile.getPublic.useQuery(
    { userId },
    { enabled: isAuthenticated && Number.isFinite(userId) && userId > 0, retry: false },
  );

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-background" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Navbar />
      <main className="container pt-24 pb-16 max-w-2xl">
        <Link href="/"><Button variant="ghost" className="mb-6 gap-2"><BackIcon className="h-4 w-4" />{lang === 'ar' ? 'رجوع' : 'Back'}</Button></Link>
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

          <div>
            <h2 className="text-sm font-semibold mb-1">{t('profile.bio_label')}</h2>
            {profile.bio ? (
              <p className="text-sm text-muted-foreground leading-6 whitespace-pre-wrap">{profile.bio}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">{t('profile.empty_bio')}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
