import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Calendar, CheckCircle2, Clock, Loader2, Plus, BarChart3 } from 'lucide-react';

const labels = {
  en: {
    timeline: 'Project Timeline', reports: 'Progress Reports',
    noMilestones: 'No milestones have been added yet.', noReports: 'No progress reports yet.',
    reportTitle: 'New Progress Report', title: 'Report title', summary: 'Summary of completed work and blockers', progress: 'Project progress (%)', addReport: 'Add Report', saving: 'Saving…',
    due: 'Due', completed: 'Completed', pending: 'Pending',
  },
  ar: {
    timeline: 'الجدول الزمني للمشروع', reports: 'تقارير التقدم',
    noMilestones: 'لم تتم إضافة معالم للمشروع بعد.', noReports: 'لا توجد تقارير تقدم بعد.',
    reportTitle: 'تقرير تقدم جديد', title: 'عنوان التقرير', summary: 'ملخص الأعمال المنجزة والمعوقات', progress: 'نسبة تقدم المشروع (%)', addReport: 'إضافة تقرير', saving: 'جاري الحفظ…',
    due: 'الاستحقاق', completed: 'مكتمل', pending: 'قيد الانتظار',
  },
} as const;

/**
 * The project operations workspace: timeline and progress reports.
 *
 * IT USED TO CARRY FILES AND INVOICES TOO, and that was one document surface
 * too many. `ProjectDocuments` is the single implementation now - one upload
 * path, one allowlist, one place a project's files live. Invoices are not
 * lost: they are a document `type`, reachable through that component's filter,
 * which is what they always were in the schema.
 *
 * The duplication was easy to miss precisely because both halves worked.
 */
export default function ProjectDetailEnhancements({ projectId, lang }: { projectId: number; lang: 'en' | 'ar' }) {
  const copy = labels[lang];
  const [reportForm, setReportForm] = useState({ title: '', summary: '', progress: '0' });
  const { data: milestones = [] } = trpc.projects.milestones.useQuery({ projectId });
  const { data: reports = [], refetch: refetchReports } = trpc.projects.progressReports.useQuery({ projectId });
  const addReport = trpc.projects.addProgressReport.useMutation({
    onSuccess: () => { toast.success(lang === 'ar' ? 'تم حفظ التقرير' : 'Progress report saved'); setReportForm({ title: '', summary: '', progress: '0' }); refetchReports(); },
    onError: error => toast.error(error.message),
  });

  return (
    <Tabs defaultValue="timeline" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <TabsList className="mb-5 flex-wrap h-auto gap-1">
        <TabsTrigger value="timeline" className="gap-1.5"><Calendar className="h-4 w-4" />{copy.timeline}</TabsTrigger>
        <TabsTrigger value="reports" className="gap-1.5"><BarChart3 className="h-4 w-4" />{copy.reports}</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />{copy.timeline}</CardTitle></CardHeader><CardContent><div className="space-y-4">{milestones.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.noMilestones}</div> : milestones.map((milestone, index) => <div key={milestone.id} className="relative flex gap-4"><div className="flex flex-col items-center"><div className={`flex h-9 w-9 items-center justify-center rounded-full ${milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-primary/10 text-primary'}`}>{milestone.status === 'completed' ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-semibold">{index + 1}</span>}</div>{index < milestones.length - 1 && <div className="mt-1 h-full min-h-8 w-px bg-border" />}</div><div className="min-w-0 flex-1 pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{milestone.title}</p><Badge variant={milestone.status === 'completed' ? 'default' : 'outline'}>{milestone.status === 'completed' ? copy.completed : copy.pending}</Badge></div>{milestone.dueDate && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{copy.due}: {new Date(milestone.dueDate as Date).toLocaleDateString()}</p>}<Progress value={milestone.progress ?? (milestone.status === 'completed' ? 100 : 0)} className="mt-3 h-1.5" /></div></div>)}</div></CardContent></Card></TabsContent>



      <TabsContent value="reports"><Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />{copy.reports}</CardTitle></CardHeader><CardContent><div className="mb-6 grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]"><Input placeholder={copy.title} value={reportForm.title} onChange={event => setReportForm(form => ({ ...form, title: event.target.value }))} /><Textarea className="md:col-span-1" placeholder={copy.summary} rows={1} value={reportForm.summary} onChange={event => setReportForm(form => ({ ...form, summary: event.target.value }))} /><Input type="number" min={0} max={100} placeholder={copy.progress} value={reportForm.progress} onChange={event => setReportForm(form => ({ ...form, progress: event.target.value }))} /><Button className="gap-1.5" onClick={() => addReport.mutate({ projectId, title: reportForm.title, summary: reportForm.summary, progress: Number(reportForm.progress) })} disabled={addReport.isPending || !reportForm.title || !reportForm.summary}>{addReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{addReport.isPending ? copy.saving : copy.addReport}</Button></div>{reports.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.noReports}</div> : <div className="space-y-3">{reports.map(report => <div key={report.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{report.title}</p><Badge>{report.progress}%</Badge></div><Progress value={report.progress} className="my-3 h-2" /><p className="text-sm text-muted-foreground">{report.summary}</p><p className="mt-2 text-xs text-muted-foreground">{report.createdAt ? new Date(report.createdAt as Date).toLocaleString() : '—'}</p></div>)}</div>}</CardContent></Card></TabsContent>
    </Tabs>
  );
}
