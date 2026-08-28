import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import Navbar from '@/components/Navbar';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ArrowRight, CheckCircle2, Package, Send, ShoppingCart, Star, Truck, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useRfqBasket } from '@/hooks/useRfqBasket';
import { getProductVariants } from '@/lib/marketplaceCatalog';

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return value.split(',').map(item => item.trim()).filter(Boolean); }
}

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const { lang } = useLanguage();
  const [question, setQuestion] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('standard');
  const [quantity, setQuantity] = useState('1');
  const basket = useRfqBasket();
  // Every product id is looked up in the database.
  //
  // This was `enabled: productId > 10` with a DEMO_PRODUCTS fallback - a
  // hardcoded boundary where ids 1 to 10 were fictional products and anything
  // above was real. A real product that happened to be assigned a low id would
  // have rendered as whichever invented item shared its number.
  const { data: storedProduct, isLoading } = trpc.marketplace.get.useQuery(
    { id: productId },
    { enabled: Number.isFinite(productId) && productId > 0, retry: false },
  );
  const product = storedProduct;
  const { data: questions = [], refetch: refetchQuestions } = trpc.marketplace.questions.useQuery({ productId }, { enabled: Number.isFinite(productId) && productId > 0 });
  const askQuestion = trpc.marketplace.askQuestion.useMutation({ onSuccess: () => { toast.success(lang === 'ar' ? 'تم إرسال السؤال للمورد' : 'Question sent to supplier'); setQuestion(''); refetchQuestions(); }, onError: error => toast.error(error.message) });
  const images = useMemo(() => parseList(product?.images), [product?.images]);
  const specs = useMemo(() => parseList(product?.specs), [product?.specs]);
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;

  if (isLoading) return <div className="min-h-screen bg-background"><Navbar /><div className="container pt-32 text-center text-muted-foreground">{lang === 'ar' ? 'جاري تحميل المنتج…' : 'Loading product…'}</div></div>;
  if (!product) return <div className="min-h-screen bg-background"><Navbar /><div className="container pt-32 text-center text-muted-foreground">{lang === 'ar' ? 'المنتج غير موجود' : 'Product not found'}</div></div>;

  const name = lang === 'ar' && product.nameAr ? product.nameAr : product.name;
  const description = lang === 'ar' && product.descriptionAr ? product.descriptionAr : product.description;
  const variants = getProductVariants(product);
  const selectedVariant = variants.find(variant => variant.id === selectedVariantId) ?? variants[0];
  const selectedPurchaseUnit = lang === 'ar' ? selectedVariant.labelAr : selectedVariant.label;

  return (
    <div className="min-h-screen bg-background" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Navbar />
      <main className="container pt-24 pb-16">
        <Link href="/marketplace/products"><Button variant="ghost" className="mb-6 gap-2"><BackIcon className="h-4 w-4" />{lang === 'ar' ? 'العودة للمنتجات' : 'Back to products'}</Button></Link>
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="overflow-hidden"><div className="aspect-[4/3] bg-muted">{images[0] ? <img src={images[0]} alt={name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Package className="h-24 w-24 text-muted-foreground/30" /></div>}</div>{images.length > 1 && <div className="grid grid-cols-4 gap-2 p-3">{images.slice(0, 4).map(image => <img key={image} src={image} alt="" className="aspect-square rounded-lg object-cover" />)}</div>}</Card>
          <div className="space-y-5"><div><div className="mb-3 flex flex-wrap items-center gap-2"><Badge>{product.category}</Badge>{product.featured && <Badge variant="secondary">{lang === 'ar' ? 'مميز' : 'Featured'}</Badge>}</div><h1 className="text-3xl font-bold">{name}</h1><p className="mt-2 text-muted-foreground">{product.brand || (lang === 'ar' ? 'علامة غير محددة' : 'Brand not specified')} · {product.origin || '—'}</p></div><div className="flex items-center gap-2"><Star className="h-5 w-5 fill-amber-400 text-amber-400" /><span className="font-semibold">{product.rating ?? '—'}</span><span className="text-sm text-muted-foreground">{product.reviewCount ?? 0} {lang === 'ar' ? 'تقييم موثق' : 'verified ratings'}</span></div><div className="flex items-end gap-2"><span className="text-3xl font-bold text-primary">{Number(product.price ?? 0).toLocaleString()} {product.currency}</span><span className="pb-1 text-sm text-muted-foreground">/{product.unit || (lang === 'ar' ? 'وحدة' : 'unit')}</span></div>{description && <p className="leading-7 text-muted-foreground">{description}</p>}<div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border p-3"><Truck className="mb-2 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'التوصيل' : 'Delivery'}</p><p className="font-medium">{product.deliveryDays ? `${product.deliveryDays} ${lang === 'ar' ? 'يوم' : 'days'}` : '—'}</p></div><div className="rounded-xl border p-3"><ShieldCheck className="mb-2 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'الضمان' : 'Warranty'}</p><p className="font-medium">{product.warranty || '—'}</p></div><div className="rounded-xl border p-3"><CheckCircle2 className="mb-2 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{lang === 'ar' ? 'المخزون' : 'Stock'}</p><p className="font-medium">{product.stock ?? 0} {product.unit || ''}</p></div></div><label className="block text-sm font-medium">{lang === 'ar' ? 'متغير المنتج' : 'Product variant'}<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={selectedVariant.id} onChange={event => setSelectedVariantId(event.target.value)}>{variants.map(variant => <option key={variant.id} value={variant.id}>{lang === 'ar' ? variant.labelAr : variant.label}</option>)}</select></label>{/*
  This wrote ONE localStorage key with setItem, so adding a second product
  silently discarded the first - under a button that says "list". It now
  appends a real basket line; adding the same product and variant twice
  increases the quantity rather than duplicating the line.
*/}
<div className="flex items-center gap-2">
  <label className="text-sm font-medium" htmlFor="rfq-quantity">{lang === 'ar' ? 'الكمية' : 'Quantity'}</label>
  <Input
    id="rfq-quantity"
    type="number"
    min={1}
    step="any"
    className="h-10 w-28"
    data-testid="product-quantity"
    value={quantity}
    onChange={event => setQuantity(event.target.value)}
  />
  <span className="text-sm text-muted-foreground">{product.unit || (lang === 'ar' ? 'وحدة' : 'unit')}</span>
</div>
<Button
  className="w-full gap-2"
  data-testid="product-add-to-rfq"
  onClick={() => {
    if (basket.isFull) {
      toast.error(lang === 'ar' ? 'قائمة طلب الأسعار ممتلئة' : 'Your RFQ list is full');
      return;
    }
    basket.add({
      productId: product.id,
      name: (lang === 'ar' && product.nameAr) ? product.nameAr : product.name,
      variantLabel: selectedPurchaseUnit,
      quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      unit: product.unit ?? null,
      specifications: null,
      unitPrice: product.price != null ? Number(product.price) : null,
    });
    toast.success(lang === 'ar' ? `تمت إضافة المنتج (${selectedPurchaseUnit}) إلى قائمة طلب الأسعار` : `Product (${selectedPurchaseUnit}) added to RFQ list`);
  }}
><ShoppingCart className="h-4 w-4" />{lang === 'ar' ? 'أضف إلى طلب الأسعار' : 'Add to RFQ list'}</Button>
{basket.count > 0 && (
  <Link href="/rfq">
    <Button variant="outline" className="w-full gap-2" data-testid="product-view-basket">
      {lang === 'ar' ? `عرض قائمة الطلبات (${basket.count})` : `View RFQ list (${basket.count})`}
    </Button>
  </Link>
)}</div>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>{lang === 'ar' ? 'المواصفات' : 'Specifications'}</CardTitle></CardHeader><CardContent>{specs.length ? <div className="space-y-2">{specs.map(spec => <div key={spec} className="flex items-start gap-2 border-b py-2 text-sm last:border-0"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{spec}</div>)}</div> : <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لم يضف المورد مواصفات لهذا المنتج بعد.' : 'The supplier has not added specifications yet.'}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{lang === 'ar' ? 'أسئلة حول المنتج' : 'Product Q&A'}</CardTitle></CardHeader><CardContent><Textarea rows={4} placeholder={lang === 'ar' ? 'اكتب سؤالك للمورد…' : 'Ask the supplier a question…'} value={question} onChange={event => setQuestion(event.target.value)} /><Button className="mt-3 gap-2" onClick={() => { if (!question.trim()) return; askQuestion.mutate({ productId, question: question.trim() }); }} disabled={!question.trim() || askQuestion.isPending}><Send className="h-4 w-4" />{askQuestion.isPending ? (lang === 'ar' ? 'جاري الإرسال…' : 'Sending…') : (lang === 'ar' ? 'إرسال السؤال' : 'Send question')}</Button>{questions.length > 0 && <div className="mt-5 space-y-3">{questions.map(item => <div key={item.id} className="rounded-lg bg-muted/40 p-3"><p className="text-sm font-medium">{item.question}</p>{item.answer && <p className="mt-2 border-s-2 border-primary ps-3 text-sm text-muted-foreground">{item.answer}</p>}</div>)}</div>}</CardContent></Card></div>
      </main>
    </div>
  );
}
