import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import VendorReputation from '@/components/VendorReputation';
import VendorAnalytics from '@/components/VendorAnalytics';
import { trpc } from '@/lib/trpc';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, DollarSign, Clock, MapPin, Send, Star, TrendingUp, CheckCircle2, Bot, Pencil, Camera, BadgeCheck, BarChart3 } from 'lucide-react';
import { useLocation } from 'wouter';
import { getRolePlatformPath } from '@/lib/rolePlatform';

function fileToBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ base64: result.split(',')[1] ?? '', contentType: file.type });
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function ProviderDashboard() {
  const { t, lang } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [quoteForm, setQuoteForm] = useState({ rfqId: 0, price: '', timeline: '', warranty: '', notes: '' });
  const [quoteOpen, setQuoteOpen] = useState(false);

  const { data: rfqs } = trpc.rfq.list.useQuery();
  const submitQuote = trpc.rfq.submitQuotation.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم تقديم العرض!' : 'Quotation submitted!'); setQuoteOpen(false); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const { data: ownProfile, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = trpc.profile.getOwn.useQuery();
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ bio: '', location: '' });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ownProfile) setProfileForm({ bio: ownProfile.bio ?? '', location: ownProfile.location ?? '' });
  }, [ownProfile]);
  const updateProfile = trpc.profile.update.useMutation({
    onSuccess: () => { toast.success(t('profile.save_success')); setEditingProfile(false); refetchProfile(); },
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const uploadAvatar = trpc.profile.uploadAvatar.useMutation({
    onSuccess: () => refetchProfile(),
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('profile.avatar_invalid_type')); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error(t('profile.avatar_too_large')); return; }
    const { base64, contentType } = await fileToBase64(file);
    uploadAvatar.mutate({ base64, contentType });
  };

  const userRole = (user as any)?.userRole ?? 'contractor';
  useEffect(() => {
    if (isAuthenticated) navigate(getRolePlatformPath(userRole));
  }, [isAuthenticated, userRole, navigate]);

  if (loading) return null;
  if (!isAuthenticated) { window.location.href = '/auth?mode=login'; return null; }

  const roleLabel = userRole.charAt(0).toUpperCase() + userRole.slice(1).replace('_', ' ');

  const statCards = [
    { label: 'Open RFQs', value: rfqs?.filter(r => r.status === 'open').length ?? 0, icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Avg Response', value: '< 2h', icon: Clock, color: 'text-green-500', bg: 'bg-green-50' },
    { label: 'Rating', value: '4.8 ★', icon: Star, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'Completed', value: '24', icon: CheckCircle2, color: 'text-purple-500', bg: 'bg-purple-50' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold">{roleLabel} Dashboard</h2>
              <Badge variant="secondary" className="capitalize">{userRole}</Badge>
            </div>
            <p className="text-muted-foreground">Welcome back, {user?.name?.split(' ')[0] ?? 'there'}!</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/ai')} className="gap-2">
            <Bot className="w-4 h-4" /> AI Assistant
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(s => (
            <Card key={s.label}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                  <s.icon className={`w-6 h-6 ${s.color}`} />
                </div>
                <div>
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Vendor Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" /> {t('profile.title')}
              </CardTitle>
              {!profileLoading && ownProfile && !editingProfile && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditingProfile(true)}>
                  <Pencil className="w-3.5 h-3.5" /> {t('common.edit')}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {profileLoading ? (
              <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>
            ) : profileError || !ownProfile ? (
              <div className="text-center py-8 text-muted-foreground">{t('profile.load_error')}</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Avatar className="size-16">
                      {ownProfile.avatar && <AvatarImage src={ownProfile.avatar} alt={ownProfile.name ?? ''} />}
                      <AvatarFallback className="text-lg font-semibold">{initials(ownProfile.name)}</AvatarFallback>
                    </Avatar>
                    {editingProfile && (
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={uploadAvatar.isPending}
                        className="absolute -bottom-1 -end-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
                        aria-label={t('profile.avatar_change')}
                      >
                        <Camera className="w-3 h-3" />
                      </button>
                    )}
                    <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold truncate">{ownProfile.name || '—'}</p>
                      {ownProfile.verified && <Badge variant="secondary" className="gap-1"><BadgeCheck className="w-3.5 h-3.5" />{t('profile.verified_badge')}</Badge>}
                    </div>
                    {uploadAvatar.isPending && <p className="text-xs text-muted-foreground">{t('profile.avatar_uploading')}</p>}
                  </div>
                </div>

                {editingProfile ? (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="vendor-bio">{t('profile.bio_label')}</Label>
                      <Textarea id="vendor-bio" rows={4} maxLength={1000} placeholder={t('profile.bio_placeholder')} value={profileForm.bio} onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="vendor-location">{t('profile.location_label')}</Label>
                      <Input id="vendor-location" maxLength={255} placeholder={t('profile.location_placeholder')} value={profileForm.location} onChange={e => setProfileForm(f => ({ ...f, location: e.target.value }))} className="mt-1" />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => updateProfile.mutate({ bio: profileForm.bio, location: profileForm.location })} disabled={updateProfile.isPending}>
                        {updateProfile.isPending ? t('common.loading') : t('common.save')}
                      </Button>
                      <Button variant="outline" onClick={() => { setEditingProfile(false); setProfileForm({ bio: ownProfile.bio ?? '', location: ownProfile.location ?? '' }); }}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-4 h-4 flex-shrink-0" /><span className="truncate">{ownProfile.location || '—'}</span></div>
                      <div className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="w-4 h-4 flex-shrink-0" /><span>{ownProfile.completedProjects} {t('profile.completed_projects')}</span></div>
                    </div>
                    <p className="text-sm text-muted-foreground leading-6 whitespace-pre-wrap">
                      {ownProfile.bio || t('profile.no_bio_own')}
                    </p>
                  </div>
                )}

                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Star className="w-3.5 h-3.5" /> {t('reputation.title')}</h3>
                  <VendorReputation userId={ownProfile.id} />
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> {t('analytics.title')}</h3>
                  <VendorAnalytics />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Available RFQs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> Available Requests for Quotation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(!rfqs || rfqs.length === 0) ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>{t('provider.no_rfqs')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rfqs.filter(r => r.status === 'open').map(rfq => (
                  <div key={rfq.id} className="p-4 rounded-xl border border-border hover:border-primary/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold mb-1">{rfq.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{rfq.description}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {rfq.category && <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{rfq.category}</span>}
                          {rfq.budget && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />EGP {Number(rfq.budget).toLocaleString()}</span>}
                          {rfq.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rfq.location}</span>}
                          {rfq.deadline && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(rfq.deadline).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <Dialog open={quoteOpen && quoteForm.rfqId === rfq.id} onOpenChange={o => { setQuoteOpen(o); if (o) setQuoteForm(f => ({ ...f, rfqId: rfq.id })); }}>
                        <DialogTrigger asChild>
                          <Button size="sm" className="gap-1.5 flex-shrink-0" onClick={() => setQuoteForm(f => ({ ...f, rfqId: rfq.id }))}>
                            <Send className="w-3.5 h-3.5" /> Submit Quote
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>{t('provider.submit_quote')}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3 mt-2">
                            <Input placeholder="Your Price (EGP)" type="number" value={quoteForm.price} onChange={e => setQuoteForm(f => ({ ...f, price: e.target.value }))} />
                            <Input placeholder="Timeline (days)" type="number" value={quoteForm.timeline} onChange={e => setQuoteForm(f => ({ ...f, timeline: e.target.value }))} />
                            <Input placeholder={t('common.warranty')} value={quoteForm.warranty} onChange={e => setQuoteForm(f => ({ ...f, warranty: e.target.value }))} />
                            <Textarea placeholder={t('common.notes')} rows={3} value={quoteForm.notes} onChange={e => setQuoteForm(f => ({ ...f, notes: e.target.value }))} />
                            <Button className="w-full gap-2" onClick={() => submitQuote.mutate({ rfqId: quoteForm.rfqId, price: parseFloat(quoteForm.price), timeline: quoteForm.timeline ? parseInt(quoteForm.timeline) : undefined, warranty: quoteForm.warranty || undefined, notes: quoteForm.notes || undefined })} disabled={submitQuote.isPending || !quoteForm.price}>
                              <Send className="w-4 h-4" /> {submitQuote.isPending ? 'Submitting...' : 'Submit Quotation'}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

