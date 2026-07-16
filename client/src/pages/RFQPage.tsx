import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { useState } from 'react';
import { toast } from 'sonner';
import { FileText, Plus, Clock, MapPin, DollarSign, CheckCircle2, XCircle, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const CATEGORIES = [
  'Materials', 'Labor', 'Complete Project', 'Engineering', 'Design',
  'Furniture', 'Maintenance', 'Renovation', 'Custom Services',
];

export default function RFQPage() {
  const { t, dir } = useLanguage();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: '', budget: '', location: '', deadline: '' });

  const { data: rfqs, refetch } = trpc.rfq.list.useQuery();
  const createRfq = trpc.rfq.create.useMutation({
    onSuccess: () => { toast.success('RFQ posted successfully!'); setOpen(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const statusColor: Record<string, string> = {
    open: 'badge-info', closed: 'badge-warning', awarded: 'badge-success',
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container pt-24 pb-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">{t('nav.rfq')}</h1>
            <p className="text-muted-foreground mt-1">Post your requirements and receive competitive quotations</p>
          </div>
          {isAuthenticated ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="w-4 h-4" /> Post RFQ</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Post a Request for Quotation</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <Input placeholder="RFQ Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                  <Textarea placeholder="Describe your requirements in detail..." rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                  <Select onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Budget (EGP)" type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
                    <Input placeholder="Location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
                  </div>
                  <Input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
                  <Button className="w-full gap-2" onClick={() => createRfq.mutate({ ...form, budget: form.budget ? parseFloat(form.budget) : undefined, deadline: form.deadline ? new Date(form.deadline) : undefined })} disabled={createRfq.isPending || !form.title}>
                    <Send className="w-4 h-4" /> {createRfq.isPending ? 'Posting...' : 'Post RFQ'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <Button onClick={() => startLogin()} className="gap-2"><Plus className="w-4 h-4" /> Post RFQ</Button>
          )}
        </div>

        <div className="grid gap-4">
          {rfqs?.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No RFQs yet. Be the first to post one!</p>
            </div>
          )}
          {rfqs?.map(rfq => (
            <Card key={rfq.id} className="card-hover">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-lg truncate">{rfq.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[rfq.status ?? 'open']}`}>
                        {rfq.status}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-sm line-clamp-2 mb-3">{rfq.description}</p>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      {rfq.category && <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{rfq.category}</span>}
                      {rfq.budget && <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />EGP {Number(rfq.budget).toLocaleString()}</span>}
                      {rfq.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{rfq.location}</span>}
                      {rfq.deadline && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{new Date(rfq.deadline).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm">View & Quote</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
