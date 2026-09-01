import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Link } from 'wouter';
import { FolderOpen, Search, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

export default function AdminProjects() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const { data: projects = [], isLoading } = trpc.admin.projects.useQuery();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return projects.filter(project => {
      const statusMatches = status === 'all' || project.status === status;
      const searchMatches = !term || `${project.title ?? ''} ${project.type ?? ''} ${project.location ?? ''} ${project.ownerName ?? ''}`.toLowerCase().includes(term);
      return statusMatches && searchMatches;
    });
  }, [projects, query, status]);

  return (
    <Card data-testid="admin-projects">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          {ar ? 'إدارة المشاريع' : 'Project Management'}
        </CardTitle>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={ar ? 'ابحث بالمشروع أو الموقع أو المالك…' : 'Search project, location or owner…'}
            />
          </div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={event => setStatus(event.target.value)}
            aria-label={ar ? 'تصفية حسب الحالة' : 'Filter by status'}
          >
            <option value="all">{ar ? 'كل الحالات' : 'All statuses'}</option>
            <option value="active">{ar ? 'نشط' : 'Active'}</option>
            <option value="completed">{ar ? 'مكتمل' : 'Completed'}</option>
            <option value="on_hold">{ar ? 'معلق' : 'On hold'}</option>
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ar ? 'جارٍ التحميل…' : 'Loading…'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {ar ? 'لا توجد مشاريع مطابقة.' : 'No matching projects.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'المشروع' : 'Project'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'المالك' : 'Owner'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'النوع' : 'Type'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="p-2 text-start font-medium text-muted-foreground">{ar ? 'التقدم' : 'Progress'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(project => (
                  <tr key={project.id} className="border-b border-border/50">
                    <td className="p-2">
                      <p className="font-medium">{project.title || `#${project.id}`}</p>
                      <p className="text-xs text-muted-foreground">{project.location || '—'}</p>
                    </td>
                    <td className="p-2">
                      {project.ownerId ? (
                        <Link href={`/admin/users/${project.ownerId}`} className="underline-offset-2 hover:underline">
                          {project.ownerName || `#${project.ownerId}`}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="p-2 text-muted-foreground">{project.type || '—'}</td>
                    <td className="p-2"><Badge variant="secondary">{project.status || '—'}</Badge></td>
                    <td className="p-2 text-muted-foreground">{project.progress ?? 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
