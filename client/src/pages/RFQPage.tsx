import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  FileText, Plus, Clock, MapPin, DollarSign, Send,
  BarChart3, ChevronRight, Users,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import QuotationComparison from '@/components/QuotationComparison';

const CATEGORIES = [
  'Materials', 'Labor', 'Complete Project', 'Engineering', 'Design',
  'Furniture', 'Maintenance', 'Renovation', 'Custom Services',
];

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
};

export default function RFQPage() {
  const { t } = useLanguage();
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', category: '', budget: '', location: '', deadline: '',
  });
  const [compareRfq, setCompareRfq] = useState<RFQItem | null>(null);

  const { data: rfqs = [], refetch } = trpc.rfq.list.useQuery();
  const { data: myRfqs = [] } = trpc.rfq.myList.useQuery(undefined, { enabled: isAuthenticated });

  const createRfq = trpc.rfq.create.useMutation({
    onSuccess: () => {
      toast.success('RFQ posted successfully!');
      setOpen(false);
      setForm({ title: '', description: '', category: '', budget: '', location: '', deadline: '' });
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Merge and deduplicate: show user's own RFQs first, then public ones
  const allRfqs: RFQItem[] = isAuthenticated
    ? [
        ...myRfqs,
        ...rfqs.filter(r => !myRfqs.some(m => m.id === r.id)),
      ]
    : rfqs;

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
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="w-4 h-4" /> {t('rfq.post')}</Button>
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
                  <Select onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue placeholder={t('rfq.category')} /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
                  <Button
                    className="w-full gap-2"
                    onClick={() => createRfq.mutate({
                      ...form,
                      budget: form.budget ? parseFloat(form.budget) : undefined,
                      deadline: form.deadline ? new Date(form.deadline) : undefined,
                    })}
                    disabled={createRfq.isPending || !form.title}
                  >
                    <Send className="w-4 h-4" />
                    {createRfq.isPending ? t('rfq.submitting') : t('rfq.submit')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <Button onClick={() => startLogin()} className="gap-2">
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
              <Card key={rfq.id} className="card-hover transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      {/* Title + status */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h3 className="font-semibold text-lg">{rfq.title}</h3>
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
                            <FileText className="w-3.5 h-3.5" />{rfq.category}
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
                    </div>

                    {/* CTA */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {isOwner ? (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setCompareRfq(rfq)}
                        >
                          <BarChart3 className="w-4 h-4" /> {t('rfq.compare')}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setCompareRfq(rfq)}
                        >
                          {t('rfq.view_details')} <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
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
