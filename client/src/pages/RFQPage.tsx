import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Pager } from '@/components/Pager';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { trpc } from '@/lib/trpc';
import { useRfqBasket } from '@/hooks/useRfqBasket';
import { useAuth } from '@/_core/hooks/useAuth';
import { Link, useSearch } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  FileText, Plus, Clock, MapPin, DollarSign, Send,
  BarChart3, Users, Paperclip, X, FileUp, Loader2,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import QuotationComparison from '@/components/QuotationComparison';
import { parseProductReference, parseRfqAttachments } from '@shared/rfqAttachments';
import { RFQ_CATEGORIES as rfqCategories, rfqCategoryLabel, type RfqCategory } from '@shared/rfqCategories';

// Phase 4B.3: the category list now comes from the shared taxonomy that RFQ
// targeting also matches against, so the two sides can never drift apart.
const CATEGORIES = rfqCategories;

const STATUS_STYLES: Record<string, string> = {
  open:    'bg-blue-100 text-blue-700 border-blue-200',
  closed:  'bg-amber-100 text-amber-700 border-amber-200',
  awarded: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

type RFQItem = {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  budget: string | null;
  location: string | null;
  deadline: Date | null;
  status: 'open' | 'closed' | 'awarded' | null;
  requesterId: number;
  createdAt: Date;
  attachments?: string | null;
  productReference?: { productId: number; variantId: string; variantLabel: string } | null;
};

type Attachment = { key: string; url: string; name: string; type: string; size: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


/** The provider work board pages now; it used to stop at the newest fifty. */
const RFQ_PAGE_SIZE = 25;

export default function RFQPage() {
  const { t, lang } = useLanguage();
  const { isAuthenticated, user } = useAuth();
  // The roles for whom an RFQ is an opportunity to respond to rather than
  // something they raised. Mirrors RFQ_SEEKING_ROLES on the server; the server
  // remains the authority - this only decides whether to OFFER the route.
  const isProvider = isAuthenticated
    && ['contractor', 'supplier', 'engineer', 'architect', 'project_manager']
      .includes((user as { userRole?: string } | null)?.userRole ?? '');
  const [open, setOpen] = useState(false);
  // `category` is typed to the taxonomy rather than to string, so an
  // unclassifiable value cannot reach rfq.create even by accident - the same
  // rule the server enforces, enforced again at compile time.
  const [form, setForm] = useState<{
    title: string; description: string; category: RfqCategory | '';
    budget: string; location: string; deadline: string;
  }>({
    title: '', description: '', category: '', budget: '', location: '', deadline: '',
  });
  const [linkedProjectId, setLinkedProjectId] = useState<string>('none');
  const { data: myProjects = [] } = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated });
  const [marketplaceProduct, setMarketplaceProduct] = useState<{ productId: number; variantId: string; variantLabel: string } | null>(null);
  const [compareRfq, setCompareRfq] = useState<RFQItem | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [uploadEta, setUploadEta] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const basket = useRfqBasket();

  /**
   * ARRIVING WITH A BASKET OPENS THE COMPOSER.
   *
   * "View RFQ list (3)" on a product page is a promise to show the list. It
   * linked to /rfq, where the list is inside a dialog that starts closed, so
   * the promise was not kept. The link now carries ?basket=1 and this opens the
   * composer on arrival - once, and only when there is actually something in
   * the basket, so a stale bookmark cannot pop a dialog over an empty list.
   */
  const search = useSearch();
  const openedFromBasket = useRef(false);
  useEffect(() => {
    if (openedFromBasket.current) return;
    if (!new URLSearchParams(search).has('basket')) return;
    if (basket.count === 0) return;
    openedFromBasket.current = true;
    setOpen(true);
  }, [search, basket.count]);
  const uploadAttachment = trpc.rfq.uploadAttachment.useMutation();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bh-rfq-product') || 'null');
      if (saved && Number.isFinite(saved.productId) && saved.variantId && saved.variantLabel) {
        const reference = { productId: Number(saved.productId), variantId: String(saved.variantId), variantLabel: String(saved.variantLabel) };
        setMarketplaceProduct(reference);
        setForm(current => ({ ...current, title: current.title || `RFQ for marketplace product #${reference.productId}`, description: current.description || `Please quote for the selected marketplace product variant: ${reference.variantLabel}.` }));
      }
    } catch { /* Ignore malformed local draft data. */ }
  }, []);

  const MAX_FILES = 6;
  const MAX_SIZE = 8 * 1024 * 1024;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    if (attachments.length + selected.length > MAX_FILES) {
      toast.error(lang === 'ar' ? `الحد الأقصى ${MAX_FILES} ملفات` : `Maximum ${MAX_FILES} files allowed`);
      return;
    }
    setUploading(true);
    for (const file of selected) {
      const isValid = file.type.startsWith('image/') || file.type === 'application/pdf';
      if (!isValid) {
        toast.error(lang === 'ar' ? `${file.name}: يُسمح فقط بالصور وملفات PDF` : `${file.name}: only images and PDF files are allowed`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast.error(lang === 'ar' ? `${file.name}: الحجم الأقصى 8 ميجابايت` : `${file.name}: max size is 8MB`);
        continue;
      }
      setUploadingName(file.name);
      setUploadProgress(0);
      setUploadSpeed(0);
      setUploadEta(null);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          const startedAt = performance.now();
          reader.onprogress = event => {
            if (!event.lengthComputable) return;
            const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
            const speed = event.loaded / elapsed;
            const progress = Math.min(Math.round((event.loaded / event.total) * 88), 88);
            setUploadProgress(progress);
            setUploadSpeed(speed);
            setUploadEta(speed > 0 ? Math.ceil((event.total - event.loaded) / speed) : null);
          };
          reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('Read failed'));
          reader.readAsDataURL(file);
        });
        setUploadProgress(92);
        const uploaded = await uploadAttachment.mutateAsync({
          fileName: file.name,
          contentType: file.type,
          base64,
        });
        setUploadProgress(100);
        setAttachments(prev => [...prev, uploaded]);
      } catch {
        toast.error(lang === 'ar' ? `فشل رفع ${file.name}` : `Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    setUploadingName('');
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadEta(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Gated on isAuthenticated to match its neighbours above and below. rfq.list
  // became a protected procedure in Slice 9 - it was returning every RFQ column,
  // including the homeowner's budget, to anonymous callers - and an UNAUTHORIZED
  // anywhere in the app bounces the visitor to /auth. The signed-out branch of
  // `allRfqs` below already expects an empty list.
  const [rfqPage, setRfqPage] = useState(0);
  const rfqList = trpc.rfq.list.useQuery(
    { page: rfqPage, pageSize: RFQ_PAGE_SIZE },
    { enabled: isAuthenticated, placeholderData: previous => previous },
  );
  const refetch = rfqList.refetch;
  const rfqs = (rfqList.data?.rows ?? []) as any[];
  const { data: myRfqs = [] } = trpc.rfq.myList.useQuery(undefined, { enabled: isAuthenticated });

  const createRfq = trpc.rfq.create.useMutation({
    onSuccess: () => {
      toast.success(lang === 'ar' ? 'تم نشر طلب العرض بنجاح!' : 'RFQ posted successfully!');
      setOpen(false);
      setForm({ title: '', description: '', category: '', budget: '', location: '', deadline: '' });
      setLinkedProjectId('none');
      setAttachments([]);
      setMarketplaceProduct(null);
      localStorage.removeItem('bh-rfq-product');
      // The lines are rows in the database now; the draft has served its purpose.
      basket.clear();
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Merge and deduplicate: show user's own RFQs first, then public ones
  const allRfqs: RFQItem[] = (isAuthenticated
    ? [
        ...myRfqs,
        ...rfqs.filter(r => !myRfqs.some(m => m.id === r.id)),
      ]
    : rfqs).map(rfq => ({ ...rfq, productReference: parseProductReference(rfq.productReference) })) as RFQItem[];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container pt-24 pb-16">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">{t('nav.rfq')}</h1>
            <p className="text-muted-foreground mt-1">
              {t('rfq.subtitle')}
            </p>
          </div>
          {isAuthenticated ? (
            <Dialog open={open} onOpenChange={setOpen}>
              {/* THE COUNT IS ON THE BUTTON, and that is not decoration.
                  The basket lives INSIDE this dialog. A customer who collected
                  three products and followed "View RFQ list (3)" from a product
                  page landed here and saw no basket and no sign their items
                  existed - the only way in was guessing that a button labelled
                  "Post an RFQ" was where the list had gone. */}
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="rfq-post-trigger">
                  <Plus className="w-4 h-4" /> {t('rfq.post')}
                  {basket.count > 0 && (
                    <span
                      className="ml-1 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs"
                      data-testid="rfq-basket-count"
                    >
                      {basket.count}
                    </span>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t('rfq.post.title')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <Input
                    placeholder={t('rfq.title.placeholder')}
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  />
                  <Textarea
                    placeholder={t('rfq.description.placeholder')}
                    rows={4}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                  {/* REQUIRED. An RFQ with no category is one the qualified-enquiry
                      system can never serve: openQualifiedEnquiry refuses it as
                      `unclassified_rfq`, so it sits in the open feed collecting
                      no responses forever. Saying so here beats a server
                      rejection after the form is filled. */}
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as RfqCategory }))}>
                    <SelectTrigger data-testid="rfq-category">
                      <SelectValue placeholder={`${t('rfq.category')} *`} />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c} value={c}>{rfqCategoryLabel(c, lang)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder={t('rfq.budget')}
                      type="number"
                      value={form.budget}
                      onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                    />
                    <Input
                      placeholder={t('rfq.location')}
                      value={form.location}
                      onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{t('rfq.deadline')}</label>
                    <Input
                      type="date"
                      value={form.deadline}
                      onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                    />
                  </div>
                  {myProjects.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{t('rfq.linkedProject')}</label>
                      <Select value={linkedProjectId} onValueChange={setLinkedProjectId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('rfq.linkedProject.none')}</SelectItem>
                          {myProjects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {/*
                    THE BASKET, REVIEWED BEFORE IT IS SENT.
                    Every line the customer collected, with the quantity they
                    can still change here, the specification they can add, and
                    the line they can drop. These become rfqItems rows.
                  */}
                  {basket.count > 0 && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="rfq-basket">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium">
                          {lang === 'ar' ? `الأصناف المطلوبة (${basket.count})` : `Requested items (${basket.count})`}
                        </p>
                        <button type="button" className="text-xs text-muted-foreground underline"
                          data-testid="rfq-basket-clear" onClick={() => basket.clear()}>
                          {lang === 'ar' ? 'إفراغ القائمة' : 'Clear list'}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {basket.items.map(item => (
                          <div key={item.key} className="rounded-md border bg-background p-2" data-testid="rfq-basket-item">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium" data-testid="rfq-basket-item-name">{item.name}</p>
                                {item.variantLabel && <p className="text-xs text-muted-foreground">{item.variantLabel}</p>}
                              </div>
                              <button type="button" className="shrink-0 text-xs text-muted-foreground underline"
                                data-testid="rfq-basket-remove"
                                aria-label={lang === 'ar' ? `إزالة ${item.name}` : `Remove ${item.name}`}
                                onClick={() => basket.remove(item.key)}>
                                {lang === 'ar' ? 'إزالة' : 'Remove'}
                              </button>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <Input type="number" min={0.01} step="any" className="h-8 w-24"
                                data-testid="rfq-basket-quantity"
                                aria-label={lang === 'ar' ? `الكمية لـ ${item.name}` : `Quantity for ${item.name}`}
                                value={String(item.quantity)}
                                onChange={event => basket.update(item.key, Number(event.target.value))} />
                              <span className="text-xs text-muted-foreground">{item.unit || (lang === 'ar' ? 'وحدة' : 'unit')}</span>
                            </div>
                            <Input className="mt-2 h-8 text-xs"
                              data-testid="rfq-basket-spec"
                              aria-label={lang === 'ar' ? `المواصفات لـ ${item.name}` : `Specifications for ${item.name}`}
                              placeholder={lang === 'ar' ? 'مواصفات (اختياري)' : 'Specifications (optional)'}
                              value={item.specifications ?? ''}
                              onChange={event => basket.specify(item.key, event.target.value)} />
                          </div>
                        ))}
                      </div>
                      {basket.subtotal != null && (
                        <p className="mt-2 text-xs text-muted-foreground" data-testid="rfq-basket-subtotal">
                          {lang === 'ar'
                            ? `السعر المعروض في السوق: ${basket.subtotal.toLocaleString()} ج.م — ليس عرض سعر`
                            : `Catalogue value: EGP ${basket.subtotal.toLocaleString()} — not a quotation`}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Attachments */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Paperclip className="w-3.5 h-3.5" />
                      {lang === 'ar' ? 'المرفقات — صور مرجعية أو مخططات PDF (حتى 6 ملفات، 8 م.ب لكل ملف)' : 'Attachments — reference images or PDF floor plans (up to 6 files, 8MB each)'}
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      className="hidden"
                      onChange={e => handleFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || attachments.length >= MAX_FILES}
                      className="w-full border-2 border-dashed border-border rounded-lg p-4 text-center text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploading ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {lang === 'ar' ? `جاري رفع ${uploadingName}…` : `Uploading ${uploadingName}…`}
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <FileUp className="w-4 h-4" />
                          {lang === 'ar' ? 'اضغط لاختيار الملفات' : 'Click to choose files'}
                        </span>
                      )}
                    </button>
                    {uploading && (
                      <div className="space-y-1.5" aria-live="polite">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{uploadProgress}%</span>
                          <span>{uploadSpeed > 0 ? `${(uploadSpeed / (1024 * 1024)).toFixed(1)} MB/s` : (lang === 'ar' ? 'جارٍ التحضير…' : 'Preparing…')}</span>
                          <span>{uploadEta !== null ? (lang === 'ar' ? `${uploadEta} ث متبقية` : `${uploadEta}s remaining`) : ''}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                    {attachments.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {attachments.map((att, i) => (
                          <div key={att.key} className="flex items-center gap-2 border rounded-lg p-2 bg-muted/30 text-xs">
                            {att.type.startsWith('image/') ? (
                              <img src={att.url} alt={att.name} className="w-10 h-10 rounded object-cover shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                                <FileText className="w-4 h-4 text-red-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium">{att.name}</p>
                              <p className="text-muted-foreground">{formatSize(att.size)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                              aria-label={lang === 'ar' ? 'إزالة' : 'Remove'}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      // Narrows `category` off '' for real rather than casting
                      // it away. The button is disabled in this state, so this
                      // is the type system agreeing with the UI, not a second
                      // rule that could drift from it.
                      if (!form.category) return;
                      createRfq.mutate({
                      ...form,
                      category: form.category,
                      budget: form.budget ? parseFloat(form.budget) : undefined,
                      deadline: form.deadline ? new Date(form.deadline) : undefined,
                      projectId: linkedProjectId !== 'none' ? Number(linkedProjectId) : undefined,
                      productReference: marketplaceProduct ?? undefined,
                      items: basket.items.length > 0
                        ? basket.items.map(item => ({
                            productId: item.productId,
                            name: item.name,
                            variantLabel: item.variantLabel,
                            quantity: item.quantity,
                            unit: item.unit,
                            specifications: item.specifications,
                          }))
                        : undefined,
                      attachments: attachments.length > 0 ? attachments : undefined,
                      });
                    }}
                    disabled={createRfq.isPending || uploading || !form.title || !form.category}
                  >
                    <Send className="w-4 h-4" />
                    {createRfq.isPending ? t('rfq.submitting') : t('rfq.submit')}
                  </Button>
                  {!form.category && (
                    <p className="text-xs text-muted-foreground" data-testid="rfq-category-required">
                      {lang === 'ar'
                        ? 'اختر فئة حتى يتمكن الموردون المطابقون من رؤية طلبك والرد عليه.'
                        : 'Choose a category so matching suppliers can see your request and respond to it.'}
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <Button onClick={() => { window.location.href = '/auth?mode=login'; }} className="gap-2">
              <Plus className="w-4 h-4" /> {t('rfq.post')}
            </Button>
          )}
        </div>

        {/* RFQ list */}
        <div className="grid gap-4">
          {allRfqs.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">{t('rfq.no_rfqs')}</p>
              <p className="text-sm mt-1">{t('rfq.no_rfqs.desc')}</p>
            </div>
          )}

          {allRfqs.map(rfq => {
            const isOwner = isAuthenticated && user?.id === rfq.requesterId;
            const statusStyle = STATUS_STYLES[rfq.status ?? 'open'] ?? STATUS_STYLES.open;

            return (
              /* NOT card-hover. The lift on hover said "this card is a link",
                 and the card body is not one: it holds its own attachment
                 links and its own CTAs, so making the whole card navigate
                 would swallow them. The affordance now belongs to the "View
                 details" button, which is what actually opens the request. */
              <Card key={rfq.id} className="transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      {/* Title + status */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Link href={`/rfq/${rfq.id}`} className="font-mono text-sm font-semibold text-primary underline-offset-2 hover:underline" data-testid="rfq-number">RFQ #{rfq.id}</Link>
                        <h3 className="font-semibold text-lg">{rfq.title}</h3>
                        {rfq.productReference && <Badge variant="outline" className="text-xs">{lang === 'ar' ? `منتج #${rfq.productReference.productId} · ${rfq.productReference.variantLabel}` : `Product #${rfq.productReference.productId} · ${rfq.productReference.variantLabel}`}</Badge>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${statusStyle}`}>
                          {rfq.status === 'open' ? t('rfq.status.open') : rfq.status === 'closed' ? t('rfq.status.closed') : rfq.status === 'awarded' ? t('rfq.status.awarded') : t('rfq.status.open')}
                        </span>
                        {isOwner && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Users className="w-3 h-3" /> {t('rfq.your_rfq')}
                          </Badge>
                        )}
                      </div>

                      {/* Description */}
                      {rfq.description && (
                        <p className="text-muted-foreground text-sm line-clamp-2 mb-3">{rfq.description}</p>
                      )}

                      {/* Meta chips */}
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        {rfq.category && (
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />{rfqCategoryLabel(rfq.category, lang)}
                          </span>
                        )}
                        {rfq.budget && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5" />{t('common.egp')} {Number(rfq.budget).toLocaleString()}
                          </span>
                        )}
                        {rfq.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />{rfq.location}
                          </span>
                        )}
                        {rfq.deadline && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />{new Date(rfq.deadline).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      {(() => {
                        const atts = parseRfqAttachments(rfq.attachments);
                        if (atts.length === 0) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            {atts.map(att => att.type.startsWith('image/') ? (
                              <a key={att.key} href={att.url} target="_blank" rel="noreferrer" title={att.name}>
                                <img src={att.url} alt={att.name} className="w-14 h-14 rounded-md object-cover border hover:opacity-80 transition-opacity" />
                              </a>
                            ) : (
                              <a key={att.key} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-2 bg-muted/30 hover:bg-muted/60 transition-colors max-w-[180px]">
                                <FileText className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                <span className="truncate">{att.name}</span>
                              </a>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* CTA
                        The only action here used to be the OWNER's compare
                        button, so a contractor or supplier browsing this page -
                        the people the RFQ exists for - saw a card with nothing
                        to do and no indication of where to respond. The
                        response workflow was real but reachable only from the
                        role platform, which is not where anyone looks after
                        reading an RFQ.

                        This does NOT open the enquiry: that spends a credit and
                        is gated on approval and declared categories. It routes
                        to the surface that owns the decision. */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Link href={`/rfq/${rfq.id}`}>
                        <Button variant="ghost" size="sm" className="gap-1.5" data-testid="rfq-open-detail">
                          {lang === 'ar' ? 'عرض التفاصيل' : 'View details'}
                        </Button>
                      </Link>
                      {isOwner ? (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setCompareRfq(rfq)}
                        >
                          <BarChart3 className="w-4 h-4" /> {t('rfq.compare')}
                        </Button>
                      ) : isProvider && rfq.status === 'open' ? (
                        /* TO THE REQUEST, not to a dashboard.
                           This was `/provider` - a bare link to the legacy shim
                           that forwards to /platform/:role. A supplier clicking
                           "Respond" on one specific card was dropped on a generic
                           workspace with no memory of which request they had
                           chosen, and had to find it again in a list.
                           `/rfq/:id` is the review experience: the brief, the
                           category, the location, and an honest statement of what
                           is free and what a credit buys. The respond CTA there
                           carries the id onward. */
                        <Link href={`/rfq/${rfq.id}`}>
                          <Button variant="outline" size="sm" className="gap-1.5" data-testid="rfq-respond">
                            {lang === 'ar' ? 'عرض الطلب والرد عليه' : 'View and respond'}
                          </Button>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/*
          THE BOARD PAGES NOW. It showed the fifty newest requests and stopped,
          with nothing on the screen to say there were more - so an RFQ that
          aged out of the feed was unreachable from the board providers browse
          for work, even though it was still open and still fetchable by id.
        */}
        {isAuthenticated && (
          <div className="mt-6">
            <Pager
              ar={lang === 'ar'} page={rfqPage} total={rfqList.data?.total ?? null}
              pageCount={Math.max(1, Math.ceil((rfqList.data?.total ?? 0) / RFQ_PAGE_SIZE))}
              onChange={setRfqPage} testId="rfq-board-pager"
            />
          </div>
        )}
      </div>

      {/* Quotation Comparison Sheet */}
      <Sheet open={!!compareRfq} onOpenChange={v => { if (!v) setCompareRfq(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-5xl overflow-y-auto p-6">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              {t('rfq.comparison.title')}
            </SheetTitle>
          </SheetHeader>
          {compareRfq && (
            <QuotationComparison
              rfqId={compareRfq.id}
              rfqTitle={compareRfq.title}
              rfqBudget={compareRfq.budget ? Number(compareRfq.budget) : undefined}
              rfqStatus={compareRfq.status}
              isOwner={isAuthenticated && user?.id === compareRfq.requesterId}
              onClose={() => setCompareRfq(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
