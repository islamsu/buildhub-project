import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useState } from 'react';
import ProjectDetailEnhancements from '@/components/ProjectDetailEnhancements';
import ReviewSubmissionPanel from '@/components/ReviewSubmissionPanel';
import { toast } from 'sonner';
import { Link, useParams } from 'wouter';
import {
  ArrowLeft, Plus, CheckCircle2, Clock, AlertCircle, Calendar,
  DollarSign, Users, FileText, BarChart3, Wrench, Flag,
  TrendingUp, MapPin, Bot, ClipboardList, BookOpen, Star
} from 'lucide-react';

export default function ProjectDetail() {
  const { t, lang } = useLanguage();
const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low:    { label: lang === 'ar' ? 'منخفضة' : 'Low',    color: 'badge-info' },
  medium: { label: lang === 'ar' ? 'متوسطة' : 'Medium', color: 'badge-warning' },
  high:   { label: lang === 'ar' ? 'عالية' : 'High',   color: 'badge-error' },
};

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  todo:        { label: lang === 'ar' ? 'قيد الانتظار' : 'To Do',       color: 'text-muted-foreground', icon: Clock },
  in_progress: { label: lang === 'ar' ? 'قيد التنفيذ' : 'In Progress', color: 'text-blue-500',         icon: TrendingUp },
  done:        { label: lang === 'ar' ? 'مكتملة' : 'Done',        color: 'text-green-500',        icon: CheckCircle2 },
};

  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id ?? '0');
  const { isAuthenticated, loading } = useAuth();

  // Task form
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium' as const, dueDate: '' });

  // Milestone form
  const [msOpen, setMsOpen] = useState(false);
  const [msForm, setMsForm] = useState({ title: '', dueDate: '' });

  // Expense form
  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState({ category: '', description: '', amount: '' });

  // Daily log form
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({ description: '', weather: '', workers: '' });

  const { data: project, refetch: refetchProject } = trpc.projects.get.useQuery({ id: projectId }, { enabled: isAuthenticated && projectId > 0 });
  const { data: tasks, refetch: refetchTasks } = trpc.projects.tasks.useQuery({ projectId }, { enabled: isAuthenticated && projectId > 0 });
  const { data: milestones, refetch: refetchMs } = trpc.projects.milestones.useQuery({ projectId }, { enabled: isAuthenticated && projectId > 0 });
  const { data: expenses, refetch: refetchExp } = trpc.projects.expenses.useQuery({ projectId }, { enabled: isAuthenticated && projectId > 0 });
  const { data: dailyLogs, refetch: refetchLogs } = trpc.projects.dailyLogs.useQuery({ projectId }, { enabled: isAuthenticated && projectId > 0 });

  const addTask = trpc.projects.addTask.useMutation({ onSuccess: () => { toast.success(lang === 'ar' ? 'تمت إضافة المهمة!' : 'Task added!'); setTaskOpen(false); refetchTasks(); setTaskForm({ title: '', description: '', priority: 'medium', dueDate: '' }); }, onError: (e: { message: string }) => toast.error(e.message) });
  const updateTask = trpc.projects.updateTask.useMutation({ onSuccess: () => refetchTasks(), onError: (e: { message: string }) => toast.error(e.message) });
  const addMilestone = trpc.projects.addMilestone.useMutation({ onSuccess: () => { toast.success(lang === 'ar' ? 'تمت إضافة المعلم!' : 'Milestone added!'); setMsOpen(false); refetchMs(); setMsForm({ title: '', dueDate: '' }); }, onError: (e: { message: string }) => toast.error(e.message) });
  const addExpense = trpc.projects.addExpense.useMutation({ onSuccess: () => { toast.success(lang === 'ar' ? 'تم تسجيل المصروف!' : 'Expense recorded!'); setExpOpen(false); refetchExp(); setExpForm({ category: '', description: '', amount: '' }); }, onError: (e: { message: string }) => toast.error(e.message) });
  const addLog = trpc.projects.addDailyLog.useMutation({ onSuccess: () => { toast.success(lang === 'ar' ? 'تم إضافة السجل!' : 'Log added!'); setLogOpen(false); refetchLogs(); setLogForm({ description: '', weather: '', workers: '' }); }, onError: (e: { message: string }) => toast.error(e.message) });
  const updateProject = trpc.projects.update.useMutation({ onSuccess: () => { toast.success(lang === 'ar' ? 'تم تحديث المشروع!' : 'Project updated!'); refetchProject(); }, onError: (e: { message: string }) => toast.error(e.message) });

  if (loading) return null;
  if (!isAuthenticated) { window.location.href = '/auth?mode=login'; return null; }

  const totalExpenses = expenses?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
  const doneTasks = tasks?.filter(t => t.status === 'done').length ?? 0;
  const totalTasks = tasks?.length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container pt-24 pb-16">
        {/* Back */}
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="mb-6 gap-2 -ml-2">
            <ArrowLeft className="w-4 h-4" /> {lang === 'ar' ? 'العودة للوحة التحكم' : 'Back to Dashboard'}
          </Button>
        </Link>

        {!project ? (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>{t('common.loading')}</p>
          </div>
        ) : (
          <>
            {/* Project Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold">{project.title}</h1>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize badge-info`}>{project.status}</span>
                </div>
                {project.description && <p className="text-muted-foreground">{project.description}</p>}
                <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                  {project.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{project.location}</span>}
                  <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{lang === 'ar' ? 'أُنشئ ' : 'Created '}{new Date(project.createdAt).toLocaleDateString()}</span>
                  {project.budget && <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />{lang === 'ar' ? 'الميزانية: ' : 'Budget: '}{t('common.egp')} {Number(project.budget).toLocaleString()}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open('/ai', '_blank')}>
                  <Bot className="w-4 h-4" /> {lang === 'ar' ? 'مساعدة AI' : 'AI Help'}
                </Button>
                <Select value={project.status ?? 'planning'} onValueChange={v => updateProject.mutate({ id: projectId, status: v as any })}>
                  <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['planning', 'active', 'on_hold', 'completed', 'cancelled'].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{lang === 'ar' ? {'planning':'تخطيط','active':'نشط','on_hold':'متوقف','completed':'مكتمل','cancelled':'ملغي'}[s] ?? s : s.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: t('project.progress'), value: `${project.progress ?? 0}%`, icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50', extra: <Progress value={project.progress ?? 0} className="h-1 mt-1" /> },
                { label: t('project.tasks'), value: `${doneTasks}/${totalTasks}`, icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50' },
                { label: t('project.budget'), value: project.budget ? `${t('common.egp')} ${Number(project.budget).toLocaleString()}` : '—', icon: DollarSign, color: 'text-amber-500', bg: 'bg-amber-50' },
                { label: t('project.budget_used'), value: `${t('common.egp')} ${totalExpenses.toLocaleString()}`, icon: BarChart3, color: 'text-purple-500', bg: 'bg-purple-50' },
              ].map(s => (
                <Card key={s.label}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                      <s.icon className={`w-5 h-5 ${s.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-base truncate">{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      {s.extra}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="tasks">
              <TabsList className="mb-6 flex-wrap h-auto gap-1">
                <TabsTrigger value="tasks" className="gap-1.5"><CheckCircle2 className="w-4 h-4" /> {t('project.tasks')} ({totalTasks})</TabsTrigger>
                <TabsTrigger value="milestones" className="gap-1.5"><Flag className="w-4 h-4" /> {t('project.milestones')} ({milestones?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="expenses" className="gap-1.5"><DollarSign className="w-4 h-4" /> {t('project.expenses')}</TabsTrigger>
                <TabsTrigger value="logs" className="gap-1.5"><BookOpen className="w-4 h-4" /> {t('project.daily_logs')}</TabsTrigger>
                <TabsTrigger value="documents" className="gap-1.5"><FileText className="w-4 h-4" /> {t('project.documents')}</TabsTrigger>
                <TabsTrigger value="operations" className="gap-1.5"><BarChart3 className="w-4 h-4" /> {lang === 'ar' ? 'عمليات المشروع' : 'Project Operations'}</TabsTrigger>
                <TabsTrigger value="reviews" className="gap-1.5"><Star className="w-4 h-4" /> {t('review.tab_label')}</TabsTrigger>
              </TabsList>

              {/* Tasks */}
              <TabsContent value="tasks">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{lang === 'ar' ? 'قائمة المهام' : 'Task List'}</h3>
                  <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> {t('project.add_task')}</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader><DialogTitle>{t('project.add_task')}</DialogTitle></DialogHeader>
                      <div className="space-y-3 mt-2">
                        <Input placeholder={lang === 'ar' ? 'عنوان المهمة' : 'Task title'} value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} />
                        <Textarea placeholder={lang === 'ar' ? 'الوصف (اختياري)' : 'Description (optional)'} rows={2} value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} />
                        <div className="grid grid-cols-2 gap-3">
                          <Select value={taskForm.priority} onValueChange={v => setTaskForm(f => ({ ...f, priority: v as any }))}>
                            <SelectTrigger><SelectValue placeholder={lang === 'ar' ? 'الأولوية' : 'Priority'} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">{t('project.priority.low')}</SelectItem>
                              <SelectItem value="medium">{t('project.priority.medium')}</SelectItem>
                              <SelectItem value="high">{t('project.priority.high')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input type="date" value={taskForm.dueDate} onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))} />
                        </div>
                        <Button className="w-full" onClick={() => addTask.mutate({ projectId, ...taskForm, dueDate: taskForm.dueDate ? new Date(taskForm.dueDate) : undefined })} disabled={addTask.isPending || !taskForm.title}>
                          {addTask.isPending ? (lang === 'ar' ? 'جاري الإضافة...' : 'Adding...') : t('project.add_task')}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="space-y-2">
                  {(!tasks || tasks.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>{t('project.no_tasks')}</p>
                    </div>
                  )}
                  {tasks?.map(task => {
                    const sc = TASK_STATUS_CONFIG[task.status ?? 'todo'];
                    const pc = PRIORITY_CONFIG[task.priority ?? 'medium'];
                    const StatusIcon = sc.icon;
                    return (
                      <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors group">
                        <button
                          onClick={() => updateTask.mutate({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })}
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${task.status === 'done' ? 'bg-green-500 border-green-500' : 'border-muted-foreground hover:border-primary'}`}
                        >
                          {task.status === 'done' && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>{task.title}</p>
                          {task.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {task.dueDate && <span className="text-xs text-muted-foreground hidden sm:block">{new Date(task.dueDate).toLocaleDateString()}</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pc.color}`}>{pc.label}</span>
                          <Select value={task.status ?? 'todo'} onValueChange={v => updateTask.mutate({ id: task.id, status: v as any })}>
                            <SelectTrigger className="w-28 h-7 text-xs border-0 bg-muted"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="todo">{t('common.status.pending')}</SelectItem>
                              <SelectItem value="in_progress">{t('common.status.in_progress')}</SelectItem>
                              <SelectItem value="done">{t('common.status.completed')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              {/* Milestones */}
              <TabsContent value="milestones">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{lang === 'ar' ? 'معالم المشروع' : 'Project Milestones'}</h3>
                  <Dialog open={msOpen} onOpenChange={setMsOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Add Milestone</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-sm">
                      <DialogHeader><DialogTitle>{t('project.add_milestone')}</DialogTitle></DialogHeader>
                      <div className="space-y-3 mt-2">
                        <Input placeholder={lang === 'ar' ? 'عنوان المعلم' : 'Milestone title'} value={msForm.title} onChange={e => setMsForm(f => ({ ...f, title: e.target.value }))} />
                        <Input type="date" value={msForm.dueDate} onChange={e => setMsForm(f => ({ ...f, dueDate: e.target.value }))} />
                        <Button className="w-full" onClick={() => addMilestone.mutate({ projectId, title: msForm.title, dueDate: msForm.dueDate ? new Date(msForm.dueDate) : undefined })} disabled={addMilestone.isPending || !msForm.title}>
                          Add Milestone
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="space-y-3">
                  {(!milestones || milestones.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                      <Flag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>{t('project.no_milestones')}</p>
                    </div>
                  )}
                  {milestones?.map((ms, i) => (
                    <div key={ms.id} className="flex items-center gap-4 p-4 rounded-xl border border-border">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${ms.status === 'completed' ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'}`}>
                        {ms.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium ${ms.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>{ms.title}</p>
                        {ms.dueDate && <p className="text-xs text-muted-foreground mt-0.5">Due: {new Date(ms.dueDate as Date).toLocaleDateString()}</p>}
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ms.status === 'completed' ? 'badge-success' : 'badge-info'}`}>
                        {ms.status === 'completed' ? (lang === 'ar' ? 'مكتمل' : 'Completed') : (lang === 'ar' ? 'قيد الانتظار' : 'Pending')}
                      </span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Expenses */}
              <TabsContent value="expenses">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="font-semibold">{lang === 'ar' ? 'متتبع المصروفات' : 'Expense Tracker'}</h3>
                    <p className="text-sm text-muted-foreground">Total: EGP {totalExpenses.toLocaleString()}</p>
                  </div>
                  <Dialog open={expOpen} onOpenChange={setExpOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Add Expense</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-sm">
                      <DialogHeader><DialogTitle>{t('project.add_expense')}</DialogTitle></DialogHeader>
                      <div className="space-y-3 mt-2">
                        <Input placeholder="Category (e.g. Materials, Labor)" value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))} />
                        <Input placeholder={lang === 'ar' ? 'الوصف' : 'Description'} value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} />
                        <Input type="number" placeholder="Amount (EGP)" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))} />
                        <Button className="w-full" onClick={() => addExpense.mutate({ projectId, ...expForm, amount: parseFloat(expForm.amount) })} disabled={addExpense.isPending || !expForm.amount}>
                          Record Expense
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="space-y-2">
                  {(!expenses || expenses.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                      <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>{t('project.no_expenses')}</p>
                    </div>
                  )}
                  {expenses?.map(exp => (
                    <div key={exp.id} className="flex items-center justify-between p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                          <DollarSign className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{exp.description || exp.category || 'Expense'}</p>
                          <p className="text-xs text-muted-foreground">{exp.category} · {exp.date ? new Date(exp.date as unknown as Date).toLocaleDateString() : "Today"}</p>
                        </div>
                      </div>
                      <p className="font-semibold text-sm">EGP {Number(exp.amount).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Daily Logs */}
              <TabsContent value="logs">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{lang === 'ar' ? 'سجلات الموقع اليومية' : 'Daily Site Logs'}</h3>
                  <Dialog open={logOpen} onOpenChange={setLogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Add Log</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader><DialogTitle>{t('project.add_log')}</DialogTitle></DialogHeader>
                      <div className="space-y-3 mt-2">
                        <Textarea placeholder={lang === 'ar' ? 'ماذا حدث اليوم؟ الأعمال المنجزة، المشكلات، الملاحظات...' : 'What happened today? Work done, issues, observations...'} rows={4} value={logForm.description} onChange={e => setLogForm(f => ({ ...f, description: e.target.value }))} />
                        <div className="grid grid-cols-2 gap-3">
                          <Input placeholder="Weather (e.g. Sunny)" value={logForm.weather} onChange={e => setLogForm(f => ({ ...f, weather: e.target.value }))} />
                          <Input type="number" placeholder={lang === 'ar' ? 'عدد العمال في الموقع' : 'Workers on site'} value={logForm.workers} onChange={e => setLogForm(f => ({ ...f, workers: e.target.value }))} />
                        </div>
                        <Button className="w-full" onClick={() => addLog.mutate({ projectId, description: logForm.description, weather: logForm.weather || undefined, workers: logForm.workers ? parseInt(logForm.workers) : undefined })} disabled={addLog.isPending || !logForm.description}>
                          Save Log
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="space-y-3">
                  {(!dailyLogs || dailyLogs.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                      <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>{t('project.no_logs')}</p>
                    </div>
                  )}
                  {dailyLogs?.map(log => (
                    <Card key={log.id} className="border-border">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <p className="text-sm font-medium text-muted-foreground">{log.date ? new Date(log.date as Date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Today'}</p>
                          <div className="flex gap-2 text-xs text-muted-foreground flex-shrink-0">
                            {log.weather && <span>☁️ {log.weather}</span>}
                            {log.workers && <span>👷 {log.workers} workers</span>}
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed">{log.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              {/* Documents */}
              <TabsContent value="documents">
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="font-medium mb-1">{lang === 'ar' ? 'إدارة المستندات' : 'Document Management'}</p>
                  <p className="text-sm">{lang === 'ar' ? 'ارفع المخططات والكميات والعقود والفواتير' : 'Upload drawings, BOQs, contracts, and invoices'}</p>
                  <Button className="mt-4 gap-2" variant="outline">
                    <Plus className="w-4 h-4" /> Upload Document
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="operations">
                <ProjectDetailEnhancements projectId={projectId} lang={lang} />
              </TabsContent>

              <TabsContent value="reviews">
                <ReviewSubmissionPanel projectId={projectId} isCompleted={project?.status === 'completed'} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
