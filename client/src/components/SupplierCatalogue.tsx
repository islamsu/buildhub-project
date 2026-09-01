import { useState } from 'react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Package, Pencil, ImagePlus, Star, Trash2, Eye, EyeOff, MessageCircleQuestion } from 'lucide-react';
import {
  MAX_PRODUCT_IMAGES,
  MAX_PRODUCT_IMAGE_SIZE,
  PRODUCT_IMAGE_TYPES,
  isProductImageType,
  parseProductImages,
} from '@shared/productImages';

/**
 * THE SUPPLIER'S CATALOGUE.
 *
 * `marketplace.create` existed and nothing else did, so a supplier could list a
 * product and then never correct a price, add a photo or take it down. This is
 * the surface for the three procedures that close that: updateProduct,
 * setProductImages and setProductActive - plus the answer side of the product
 * Q&A, which had a buyer-facing question box and no way for the supplier to
 * reply.
 *
 * ORDER IS THE PRIMARY IMAGE. images[0] is what the marketplace card and the
 * top of the product page render, so "make primary" is a move-to-front rather
 * than a separate flag that could drift out of step with the array.
 */

type Product = {
  id: number;
  name: string;
  nameAr?: string | null;
  category: string;
  description?: string | null;
  brand?: string | null;
  price?: string | null;
  stock?: number | null;
  unit?: string | null;
  deliveryDays?: number | null;
  images?: string | null;
  active?: boolean | null;
};

const readAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('read-failed'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.readAsDataURL(file);
});

export default function SupplierCatalogue() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();

  const { data: products = [], isLoading } = trpc.marketplace.myProducts.useQuery();
  const { data: questions = [] } = trpc.marketplace.myProductQuestions.useQuery();

  const [imaging, setImaging] = useState<Product | null>(null);
  const [answering, setAnswering] = useState<{ id: number; question: string; productName: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [uploading, setUploading] = useState(false);

  const refresh = () => utils.marketplace.myProducts.invalidate();

  const setActive = trpc.marketplace.setProductActive.useMutation({
    onSuccess: result => {
      toast.success(result.active
        ? (ar ? 'تم نشر المنتج' : 'Product published')
        : (ar ? 'تم إخفاء المنتج' : 'Product delisted'));
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const uploadImage = trpc.marketplace.uploadProductImage.useMutation();
  const setImages = trpc.marketplace.setProductImages.useMutation({
    onSuccess: () => { toast.success(ar ? 'تم تحديث الصور' : 'Images updated'); refresh(); },
    onError: error => toast.error(error.message),
  });
  const answerQuestion = trpc.marketplace.answerQuestion.useMutation({
    onSuccess: () => {
      toast.success(ar ? 'تم إرسال الرد' : 'Answer sent');
      setAnswering(null); setAnswer('');
      utils.marketplace.myProductQuestions.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  // The images currently on the product being managed, read from the row so the
  // dialog always reflects what is stored rather than local state that drifted.
  const current = imaging ? products.find((p: Product) => p.id === imaging.id) ?? imaging : null;
  const currentImages = parseProductImages(current?.images);

  const commitImages = (next: string[]) => {
    if (!current) return;
    setImages.mutate({ id: current.id, images: next });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !current) return;
    const room = MAX_PRODUCT_IMAGES - currentImages.length;
    if (room <= 0) {
      toast.error(ar
        ? `الحد الأقصى ${MAX_PRODUCT_IMAGES} صور لكل منتج`
        : `A product can have at most ${MAX_PRODUCT_IMAGES} images`);
      return;
    }

    setUploading(true);
    const uploaded: string[] = [];
    try {
      // Validated CLIENT-SIDE for a fast, clear message, and again on the
      // server, which sniffs the real bytes. The client check is courtesy; the
      // server check is the one that counts.
      for (const file of Array.from(files).slice(0, room)) {
        if (!isProductImageType(file.type)) {
          toast.error(`${file.name}: ${ar ? 'يسمح بصور PNG و JPEG و WEBP فقط' : 'only PNG, JPEG and WEBP images are allowed'}`);
          continue;
        }
        if (file.size > MAX_PRODUCT_IMAGE_SIZE) {
          toast.error(`${file.name}: ${ar ? 'الحد الأقصى 5 ميجابايت' : 'maximum 5MB'}`);
          continue;
        }
        const base64 = await readAsBase64(file);
        const stored = await uploadImage.mutateAsync({
          fileName: file.name,
          contentType: file.type as (typeof PRODUCT_IMAGE_TYPES)[number],
          base64,
        });
        uploaded.push(stored.url);
      }
      if (uploaded.length > 0) commitImages([...currentImages, ...uploaded]);
    } catch (error) {
      // A partial failure must not be reported as success, and the images that
      // DID upload are still committed above only when at least one succeeded.
      toast.error(error instanceof Error && error.message
        ? error.message
        : (ar ? 'تعذر رفع الصورة' : 'Could not upload that image'));
    } finally {
      setUploading(false);
    }
  };

  const unanswered = questions.filter((q: { answer?: string | null }) => !q.answer);

  if (isLoading) {
    return <p className="py-6 text-sm text-muted-foreground">{ar ? 'جاري التحميل…' : 'Loading…'}</p>;
  }

  return (
    <div className="space-y-6">
      {/* ── Questions waiting on this supplier ─────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircleQuestion className="h-4 w-4" />
            {ar ? 'أسئلة العملاء' : 'Customer questions'}
            {unanswered.length > 0 && (
              <Badge variant="destructive" data-testid="catalogue-unanswered-count">{unanswered.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ar
                ? 'لم يسأل أحد عن منتجاتك بعد. تظهر الأسئلة هنا عندما يسأل عميل عن منتج مدرج.'
                : 'Nobody has asked about your products yet. Questions appear here when a customer asks about one of your listings.'}
            </p>
          ) : (
            <div className="space-y-2">
              {questions.slice(0, 8).map((q: {
                id: number; question: string; answer?: string | null; productName?: string | null;
              }) => (
                <div key={q.id} className="rounded-lg border p-3" data-testid="catalogue-question">
                  <p className="text-xs text-muted-foreground">{q.productName}</p>
                  <p className="mt-0.5 text-sm">{q.question}</p>
                  {q.answer ? (
                    <p className="mt-2 border-s-2 border-primary ps-3 text-sm text-muted-foreground">{q.answer}</p>
                  ) : (
                    <Button
                      size="sm" variant="outline" className="mt-2"
                      data-testid="catalogue-answer"
                      onClick={() => { setAnswering({ id: q.id, question: q.question, productName: q.productName ?? '' }); setAnswer(''); }}
                    >
                      {ar ? 'رد' : 'Answer'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── The catalogue ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />{ar ? 'الكتالوج' : 'Catalogue'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <div className="rounded-xl border border-dashed py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {ar
                  ? 'لم تدرج أي منتج بعد. أضف منتجك الأول ليظهر في السوق ويصبح قابلاً للاكتشاف من قبل المشترين.'
                  : "You haven't listed any products yet. Add your first product and it will appear in the marketplace and become discoverable to buyers."}
              </p>
              <Link href="/products/new">
                <Button className="mt-3 gap-1.5" data-testid="catalogue-empty-add">
                  <Package className="h-4 w-4" />{ar ? 'أضف منتجاً' : 'Add product'}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {products.map((product: Product) => {
                const images = parseProductImages(product.images);
                const live = product.active !== false;
                return (
                  <div key={product.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3" data-testid="catalogue-row">
                    {images[0]
                      ? <img src={images[0]} alt="" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                      : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted"><Package className="h-5 w-5 text-muted-foreground/50" /></div>}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{ar && product.nameAr ? product.nameAr : product.name}</p>
                        {!live && <Badge variant="outline" className="text-xs">{ar ? 'مخفي' : 'Delisted'}</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {product.category}
                        {product.price ? ` · ${Number(product.price).toLocaleString()}` : ''}
                        {images.length > 0 ? ` · ${images.length} ${ar ? 'صورة' : 'image(s)'}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-1">
                      {/* A PAGE, not a dialog. Editing a product now has an
                          address that survives a refresh and can be linked to
                          - and it is the same form that lists a new one, so a
                          field cannot exist on one and be missing from the
                          other. Ownership is still the server's: updateProduct
                          carries supplierId in its UPDATE predicate. */}
                      <Link href={`/products/${product.id}/edit`}>
                        <Button size="sm" variant="ghost" data-testid="catalogue-edit" asChild={false}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button size="sm" variant="ghost" data-testid="catalogue-images" onClick={() => setImaging(product)}>
                        <ImagePlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" data-testid="catalogue-toggle"
                        title={live ? (ar ? 'إخفاء' : 'Delist') : (ar ? 'نشر' : 'Publish')}
                        onClick={() => setActive.mutate({ id: product.id, active: !live })}
                        disabled={setActive.isPending}
                      >
                        {live ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Images ─────────────────────────────────────────────────────── */}
      <Dialog open={!!imaging} onOpenChange={open => { if (!open) setImaging(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{ar ? 'صور المنتج' : 'Product images'}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            {ar
              ? `الصورة الأولى هي الصورة الرئيسية التي تظهر في السوق. حتى ${MAX_PRODUCT_IMAGES} صور، 5 ميجابايت لكل صورة.`
              : `The first image is the primary one shown in the marketplace. Up to ${MAX_PRODUCT_IMAGES} images, 5MB each.`}
          </p>

          {currentImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {currentImages.map((image, index) => (
                <div key={image} className="group relative" data-testid="catalogue-image">
                  <img src={image} alt="" className="aspect-square w-full rounded-md border object-cover" />
                  {index === 0 && (
                    <Badge className="absolute start-1 top-1 gap-1 px-1 py-0 text-[10px]">
                      <Star className="h-2.5 w-2.5" />{ar ? 'رئيسية' : 'Primary'}
                    </Badge>
                  )}
                  <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {index > 0 && (
                      <Button
                        size="sm" variant="secondary" className="h-6 px-1.5 text-[10px]"
                        data-testid="catalogue-make-primary"
                        onClick={() => commitImages([image, ...currentImages.filter(i => i !== image)])}
                      >
                        <Star className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="sm" variant="destructive" className="h-6 px-1.5 text-[10px]"
                      data-testid="catalogue-remove-image"
                      onClick={() => commitImages(currentImages.filter(i => i !== image))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="mt-2 block">
            <input
              type="file" multiple accept={PRODUCT_IMAGE_TYPES.join(',')} className="hidden"
              data-testid="catalogue-image-input"
              onChange={e => { void handleFiles(e.target.files); e.target.value = ''; }}
            />
            <Button asChild variant="outline" className="w-full gap-2" disabled={uploading || currentImages.length >= MAX_PRODUCT_IMAGES}>
              <span>
                <ImagePlus className="h-4 w-4" />
                {uploading
                  ? (ar ? 'جاري الرفع…' : 'Uploading…')
                  : currentImages.length >= MAX_PRODUCT_IMAGES
                    ? (ar ? 'اكتمل الحد الأقصى' : 'Maximum reached')
                    : (ar ? 'إضافة صور' : 'Add images')}
              </span>
            </Button>
          </label>
        </DialogContent>
      </Dialog>

      {/* ── Answer a question ──────────────────────────────────────────── */}
      <Dialog open={!!answering} onOpenChange={open => { if (!open) setAnswering(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{ar ? 'الرد على السؤال' : 'Answer the question'}</DialogTitle></DialogHeader>
          {answering && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">{answering.productName}</p>
                <p className="mt-0.5 text-sm">{answering.question}</p>
              </div>
              <Textarea
                rows={4} value={answer} onChange={e => setAnswer(e.target.value)}
                placeholder={ar ? 'اكتب ردك…' : 'Write your answer…'}
              />
              <p className="text-xs text-muted-foreground">
                {ar
                  ? 'سيظهر ردك علنًا على صفحة المنتج ولا يمكن تعديله بعد الإرسال.'
                  : 'Your answer appears publicly on the product page and cannot be edited once sent.'}
              </p>
              <Button
                className="w-full" data-testid="catalogue-submit-answer"
                disabled={answerQuestion.isPending || answer.trim().length < 2}
                onClick={() => answerQuestion.mutate({ questionId: answering.id, answer: answer.trim() })}
              >
                {answerQuestion.isPending ? (ar ? 'جاري الإرسال…' : 'Sending…') : (ar ? 'إرسال الرد' : 'Send answer')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
