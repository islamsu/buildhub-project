import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileText, DollarSign, Clock, MapPin, Send, Star, TrendingUp, CheckCircle2, Bot } from 'lucide-react';
import { useLocation } from 'wouter';
import { getRolePlatformPath } from '@/lib/rolePlatform';

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

