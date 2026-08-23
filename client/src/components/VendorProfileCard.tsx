import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { BadgeCheck, Camera, CheckCircle2, MapPin, Pencil } from 'lucide-react';

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

/**
 * Self-scoped vendor profile card: view + edit own bio/location/avatar, plus
 * the completed-project count. Reuses profile.getOwn/update/uploadAvatar -
 * the same self-only-by-construction backend from Phase 4A.6.1 (no userId
 * input anywhere). This is the one place that implementation is rendered;
 * do not duplicate this UI elsewhere.
 */
export default function VendorProfileCard() {
  const { t } = useLanguage();
  const { data: ownProfile, isLoading, error, refetch } = trpc.profile.getOwn.useQuery();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bio: '', location: '' });
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ownProfile) setForm({ bio: ownProfile.bio ?? '', location: ownProfile.location ?? '' });
  }, [ownProfile]);

  const updateProfile = trpc.profile.update.useMutation({
    onSuccess: () => { toast.success(t('profile.save_success')); setEditing(false); refetch(); },
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const uploadAvatar = trpc.profile.uploadAvatar.useMutation({
    onSuccess: () => refetch(),
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

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>;
  if (error || !ownProfile) return <div className="text-center py-8 text-muted-foreground">{t('profile.load_error')}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative">
            <Avatar className="size-16">
              {ownProfile.avatar && <AvatarImage src={ownProfile.avatar} alt={ownProfile.name ?? ''} />}
              <AvatarFallback className="text-lg font-semibold">{initials(ownProfile.name)}</AvatarFallback>
            </Avatar>
            {editing && (
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
        {!editing && (
          <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={() => setEditing(true)}>
            <Pencil className="w-3.5 h-3.5" /> {t('common.edit')}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="vendor-bio">{t('profile.bio_label')}</Label>
            <Textarea id="vendor-bio" rows={4} maxLength={1000} placeholder={t('profile.bio_placeholder')} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="vendor-location">{t('profile.location_label')}</Label>
            <Input id="vendor-location" maxLength={255} placeholder={t('profile.location_placeholder')} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="mt-1" />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => updateProfile.mutate({ bio: form.bio, location: form.location })} disabled={updateProfile.isPending}>
              {updateProfile.isPending ? t('common.loading') : t('common.save')}
            </Button>
            <Button variant="outline" onClick={() => { setEditing(false); setForm({ bio: ownProfile.bio ?? '', location: ownProfile.location ?? '' }); }}>
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
    </div>
  );
}
