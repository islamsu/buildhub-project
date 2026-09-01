import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { parseProductImages, MAX_PRODUCT_IMAGES } from '@shared/productImages';
import { toast } from 'sonner';
import { FolderKanban, Plus, Pencil, Trash2, ImagePlus, X } from 'lucide-react';

type FormState = {
  id: number | null;
  title: string;
  description: string;
  category: string;
  location: string;
  completionYear: string;
  services: string;
};

const EMPTY: FormState = {
  id: null, title: '', description: '', category: '', location: '', completionYear: '', services: '',
};

const readAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('read failed'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.readAsDataURL(file);
});

/**
 * PROVIDER PORTFOLIO - a real, self-managed showcase of completed work.
 * Owned by the provider (every write is scoped to ctx.user.id server-side);
 * no provider can edit another provider's portfolio.
 */
export default function PortfolioManager() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.portfolio.myItems.useQuery(undefined, { retry: false });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [images, setImages] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const uploadImage = trpc.portfolio.uploadImage.useMutation();
  const createItem = trpc.portfolio.create.useMutation({
    onSuccess: () => {
      toast.success(ar ? 'تمت إضافة العمل.' : 'Work added.');
      reset();
      void utils.portfolio.myItems.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const updateItem = trpc.portfolio.update.useMutation({
    onSuccess: () => {
      toast.success(ar ? 'تم حفظ العمل.' : 'Work saved.');
      reset();
      void utils.portfolio.myItems.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const deleteItem = trpc.portfolio.delete.useMutation({
    onSuccess: () => {
      toast.success(ar ? 'تم حذف العمل.' : 'Work removed.');
      void utils.portfolio.myItems.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const reset = () => {
    setForm(EMPTY); setImages([]); setEditing(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  const startEdit = (item: { id: number; title: string; description: string | null; category: string | null; location: string | null; completionYear: number | null; services: string | null; images: string | null }) => {
    setForm({
      id: item.id, title: item.title,
      description: item.description ?? '', category: item.category ?? '',
      location: item.location ?? '', services: item.services ?? '',
      completionYear: item.completionYear != null ? String(item.completionYear) : '',
    });
    setImages(parseProductImages(item.images));
    setEditing(true);
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PRODUCT_IMAGES - images.length;
    if (room <= 0) { toast.error(ar ? 'وصلت إلى الحد الأقصى للصور.' : 'Image limit reached.'); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          toast.error(`${file.name}: ${ar ? 'يسمح بصور PNG/JPEG/WEBP فقط' : 'only PNG/JPEG/WEBP images'}`); continue;
        }
        const base64 = await readAsBase64(file);
        const stored = await uploadImage.mutateAsync({ fileName: file.name, contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp', base64 });
        setImages(prev => [...prev, stored.url]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (ar ? 'تعذر رفع الصورة' : 'Could not upload that image'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = () => {
    if (!form.title.trim()) return;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      category: form.category.trim() || undefined,
      location: form.location.trim() || undefined,
      services: form.services.trim() || undefined,
      completionYear: form.completionYear ? Number(form.completionYear) : undefined,
      images: images.length ? images : undefined,
    };
    if (editing && form.id) updateItem.mutate({ id: form.id, ...payload });
    else createItem.mutate(payload);
  };

  const pending = createItem.isPending || updateItem.isPending;

  if (isLoading) return <p className="text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>;

  return (
    <div className="space-y-4" data-testid="portfolio-manager">
      {items.length === 0 && !editing && (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground" data-testid="portfolio-empty">
          {ar ? 'لم تضف أعمالاً بعد. أضف أول عمل لعرض خبرتك.' : 'No work added yet. Add your first project to showcase your experience.'}
        </p>
      )}

      {items.length > 0 && !editing && (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(item => {
            const imgs = parseProductImages(item.images);
            return (
              <div key={item.id} className="rounded-xl border p-3" data-testid="portfolio-item">
                {imgs[0] && <img src={imgs[0]} alt="" className="mb-2 h-28 w-full rounded-md border object-cover" />}
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[item.category, item.location, item.completionYear != null ? String(item.completionYear) : null].filter(Boolean).join(' · ') || '—'}
                </p>
                {item.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" data-testid="portfolio-edit" onClick={() => startEdit(item)}>
                    <Pencil className="h-3.5 w-3.5" /><span className="ms-1">{ar ? 'تعديل' : 'Edit'}</span>
                  </Button>
                  <Button size="sm" variant="ghost" data-testid="portfolio-delete" disabled={deleteItem.isPending} onClick={() => deleteItem.mutate({ id: item.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!editing ? (
        <Button size="sm" className="gap-2" data-testid="portfolio-add" onClick={() => setEditing(true)}>
          <Plus className="h-4 w-4" />{ar ? 'إضافة عمل' : 'Add work'}
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border p-3" data-testid="portfolio-form">
          <Input data-testid="portfolio-title" placeholder={ar ? 'عنوان العمل (مطلوب)' : 'Project title (required)'} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <Textarea data-testid="portfolio-description" rows={3} maxLength={5000} placeholder={ar ? 'الوصف' : 'Description'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Input data-testid="portfolio-category" placeholder={ar ? 'الفئة' : 'Category'} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            <Input data-testid="portfolio-location" placeholder={ar ? 'الموقع' : 'Location'} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            <Input data-testid="portfolio-year" type="number" min={1900} max={2100} placeholder={ar ? 'سنة الإنجاز' : 'Completion year'} value={form.completionYear} onChange={e => setForm(f => ({ ...f, completionYear: e.target.value }))} />
          </div>
          <Input data-testid="portfolio-services" maxLength={500} placeholder={ar ? 'الخدمات المقدمة' : 'Services performed'} value={form.services} onChange={e => setForm(f => ({ ...f, services: e.target.value }))} />

          <div className="flex flex-wrap gap-2">
            {images.map(url => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-16 w-16 rounded-md border object-cover" />
                <button type="button" className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 text-muted-foreground" onClick={() => setImages(prev => prev.filter(x => x !== url))} aria-label={ar ? 'إزالة الصورة' : 'Remove image'}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="portfolio-image-input" onChange={e => void attach(e.target.files)} />
            <Button type="button" size="sm" variant="outline" disabled={uploading || images.length >= MAX_PRODUCT_IMAGES} onClick={() => fileInput.current?.click()} data-testid="portfolio-upload">
              <ImagePlus className="h-3.5 w-3.5" /><span className="ms-1">{uploading ? (ar ? 'جاري الرفع…' : 'Uploading…') : (ar ? 'صور' : 'Images')}</span>
            </Button>
          </div>

          <div className="flex gap-2">
            <Button size="sm" data-testid="portfolio-save" disabled={pending || !form.title.trim()} onClick={submit}>
              {pending ? '…' : (ar ? 'حفظ' : 'Save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>{ar ? 'إلغاء' : 'Cancel'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
