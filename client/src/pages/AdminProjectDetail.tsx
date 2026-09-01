import DashboardLayout from '@/components/DashboardLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  FolderOpen,
  MapPin,
  MessageSquare,
  UserRound,
  Users,
} from 'lucide-react';

export default function AdminProjectDetail() {
  const { t, lang, dir } = useLanguage();
  const params = useParams();
  const [, navigate] = useLocation();
  const projectId = Number(params.id);
  const valid = Number.isInteger(projectId) && projectId > 0;
  const { data: project, isLoading } = trpc.admin.projectDetail.useQuery(
    { projectId },
    { enabled: valid },
  );

  const statusLabel = (status: string | null | undefined) => {
    if (status === 'active') return lang === 'ar' ? 'نشط' : 'Active';
    if (status === 'completed') return lang === 'ar' ? 'مكتمل' : 'Completed';
    if (status === 'on_hold') return lang === 'ar' ? 'معلق' : 'On hold';
    return status || '—';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={dir}>
        <div>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/admin/projects')}>
            <ArrowLeft className="h-4 w-4" />
            {lang === 'ar' ? 'إدارة المشاريع' : 'Project Management'}
          </Button>
        </div>

        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : !project ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">{lang === 'ar' ? 'المشروع غير موجود.' : 'Project not found.'}</CardContent></Card>
        ) : (
          <Card data-testid="admin-project-detail">
            <CardHeader>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                    <FolderOpen className="h-5 w-5" />
                    {project.title || `#${project.id}`}
                    <Badge variant="secondary">{statusLabel(project.status)}</Badge>
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{project.description || '—'}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Info icon={<MapPin className="h-4 w-4" />} label={lang === 'ar' ? 'الموقع' : 'Location'} value={project.location || '—'} />
                <Info icon={<CalendarDays className="h-4 w-4" />} label={lang === 'ar' ? 'تاريخ الإنشاء' : 'Created'} value={new Date(project.createdAt).toLocaleDateString()} />
                <Info icon={<FolderOpen className="h-4 w-4" />} label={lang === 'ar' ? 'النوع' : 'Type'} value={project.type || '—'} />
                <Info icon={<FolderOpen className="h-4 w-4" />} label={lang === 'ar' ? 'التقدم' : 'Progress'} value={`${project.progress ?? 0}%`} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <CountLink label={lang === 'ar' ? 'الطلبات' : 'RFQs'} value={project.counts.rfqs} onClick={() => navigate('/rfq')} />
                <CountLink label={lang === 'ar' ? 'المستندات' : 'Documents'} value={project.counts.documents} onClick={() => {}} />
                <CountLink label={lang === 'ar' ? 'النزاعات' : 'Disputes'} value={project.counts.disputes} onClick={() => navigate('/admin/disputes')} />
              </div>

              <section className="space-y-2">
                <p className="text-sm font-medium">{lang === 'ar' ? 'المالك' : 'Owner'}</p>
                {project.owner ? (
                  <Link href={`/admin/users/${project.owner.id}`} className="text-sm font-medium underline-offset-2 hover:underline">
                    {project.owner.name || project.owner.email || `#${project.owner.id}`}
                  </Link>
                ) : '—'}
              </section>

              <section className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" />
                  {lang === 'ar' ? 'أعضاء الفريق' : 'Team members'}
                </p>
                {project.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا يوجد أعضاء.' : 'No members.'}</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    {project.members.map(member => (
                      <div key={member.id} className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 last:border-0">
                        <Link href={`/admin/users/${member.userId}`} className="flex min-w-0 items-center gap-2 text-sm font-medium underline-offset-2 hover:underline">
                          <UserRound className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{member.name || `#${member.userId}`}</span>
                        </Link>
                        <Badge variant="outline">{member.projectRole || member.userRole || '—'}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function CountLink({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border p-3 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </button>
  );
}
