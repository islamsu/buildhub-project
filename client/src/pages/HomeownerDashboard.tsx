import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { toast } from 'sonner';
import { startLogin } from '@/const';
import {
  Plus, FolderOpen, TrendingUp, DollarSign, Calendar, MapPin,
  CheckCircle2, Clock, AlertCircle, FileText, Bot, ShoppingCart,
  BarChart3, Building2
} from 'lucide-react';
import { Link, useLocation } from 'wouter';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  planning:  { label: 'Planning',   color: 'badge-info',    icon: Clock },
  active:    { label: 'Active',     color: 'badge-success', icon: CheckCircle2 },
  on_hold:   { label: 'On Hold',    color: 'badge-warning', icon: AlertCircle },
  completed: { label: 'Completed',  color: 'badge-success', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled',  color: 'badge-error',   icon: AlertCircle },
};

export default function HomeownerDashboard() {
  const { t, dir } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', type: 'residential' as const, budget: '', location: '' });

  const { data: projects, refetch } = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated });
  const createProject = trpc.projects.create.useMutation({
    onSuccess: () => { toast.success('Project created!'); setNewProjectOpen(false); refetch(); setForm({ title: '', description: '', type: 'residential', budget: '', location: '' }); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  if (loading) return null;
  if (!isAuthenticated) { startLogin(); return null; }

  const totalBudget = projects?.reduce((s, p) => s + Number(p.budget ?? 0), 0) ?? 0;
  const totalSpent  = projects?.reduce((s, p) => s + Number(p.spent ?? 0), 0) ?? 0;
  const activeCount = projects?.filter(p => p.status === 'active').length ?? 0;

  const statCards = [
    { label: 'Total Projects', value: projects?.length ?? 0, icon: FolderOpen, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Active Projects', value: activeCount, icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50' },
    { label: 'Total Budget', value: `EGP ${totalBudget.toLocaleString()}`, icon: DollarSign, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'Total Spent', value: `EGP ${totalSpent.toLocaleString()}`, icon: BarChart3, color: 'text-purple-500', bg: 'bg-purple-50' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">
              {t('dash.overview')} 👋
            </h2>
            <p className="text-muted-foreground mt-0.5">Welcome back, {user?.name?.split(' ')[0] ?? 'there'}!</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/ai')} className="gap-2">
              <Bot className="w-4 h-4" /> AI Assistant
            </Button>
            <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> {t('project.new')}</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t('project.new')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <Input placeholder={t('project.name')} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                  <Textarea placeholder="Describe your project..." rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as any }))}>
                    <SelectTrigger><SelectValue placeholder={t('project.type')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="residential">Residential</SelectItem>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="renovation">Renovation</SelectItem>
                      <SelectItem value="finishing">Finishing</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder={t('project.budget') + ' (EGP)'} type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
                    <Input placeholder={t('project.location')} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
                  </div>
                  <Button className="w-full" onClick={() => createProject.mutate({ ...form, budget: form.budget ? parseFloat(form.budget) : undefined })} disabled={createProject.isPending || !form.title}>
                    {createProject.isPending ? 'Creating...' : 'Create Project'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(s => (
            <Card key={s.label}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                  <s.icon className={`w-6 h-6 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold truncate">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Browse Marketplace', icon: ShoppingCart, href: '/marketplace', color: 'text-blue-500' },
            { label: 'Post RFQ', icon: FileText, href: '/rfq', color: 'text-green-500' },
            { label: 'AI Assistant', icon: Bot, href: '/ai', color: 'text-purple-500' },
            { label: 'Messages', icon: Building2, href: '/messages', color: 'text-amber-500' },
          ].map(action => (
            <Card key={action.label} className="card-hover cursor-pointer" onClick={() => navigate(action.href)}>
              <CardContent className="p-4 text-center">
                <action.icon className={`w-6 h-6 mx-auto mb-2 ${action.color}`} />
                <p className="text-sm font-medium">{action.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Projects List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" /> {t('dash.projects')}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setNewProjectOpen(true)} className="gap-1">
              <Plus className="w-4 h-4" /> New
            </Button>
          </CardHeader>
          <CardContent>
            {(!projects || projects.length === 0) ? (
              <div className="text-center py-12">
                <FolderOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                <p className="text-muted-foreground mb-4">No projects yet. Create your first project!</p>
                <Button onClick={() => setNewProjectOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" /> {t('project.new')}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map(project => {
                  const sc = STATUS_CONFIG[project.status ?? 'planning'];
                  const StatusIcon = sc.icon;
                  const spentPct = project.budget ? Math.min(100, (Number(project.spent) / Number(project.budget)) * 100) : 0;
                  return (
                    <div key={project.id} className="p-4 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer" onClick={() => navigate(`/projects/${project.id}`)}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold truncate">{project.title}</h3>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {project.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}</span>}
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(project.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1 flex-shrink-0 ${sc.color}`}>
                          <StatusIcon className="w-3 h-3" /> {sc.label}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{t('project.progress')}</span>
                          <span>{project.progress ?? 0}%</span>
                        </div>
                        <Progress value={project.progress ?? 0} className="h-1.5" />
                        {project.budget && (
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Budget: EGP {Number(project.budget).toLocaleString()}</span>
                            <span>Spent: EGP {Number(project.spent ?? 0).toLocaleString()} ({spentPct.toFixed(0)}%)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
