import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Link, useSearch } from 'wouter';
import { FolderOpen, Search, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Pager } from '@/components/Pager';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';

const PAGE_SIZE = 25;

export default function AdminProjects() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const search = useSearch();
  const initialStatus = new URLSearchParams(search).get('status') === 'active' ? 'active' : 'all';
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(0);

  /*
   * BOTH THE SEARCH AND THE STATUS FILTER RUN IN THE QUERY. They filtered a
   * `.limit(250)` array, so either could answer "no matching projects" about a
   * project the response never carried.
   */
  const list = trpc.admin.projects.useQuery(
    { page, pageSize: PAGE_SIZE, search: query || undefined, status },
    { retry: false, placeholderData: previous => previous },
  );
  const isLoading = list.isLoading;
  const filtered = (list.data?.rows ?? []) as any[];

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
              value={typed}
              data-testid="admin-projects-search"
              onChange={event => setTyped(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { setQuery(typed.trim()); setPage(0); }
              }}
              onBlur={() => { setQuery(typed.trim()); setPage(0); }}
              placeholder={ar ? 'ابحث بالمشروع أو الموقع أو المالك…' : 'Search project, location or owner…'}
            />
          </div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={event => { setStatus(event.target.value); setPage(0); }}
            aria-label={ar ? 'تصفية حسب الحالة' : 'Filter by status'}
          >
            <option value="all">{ar ? 'كل الحالات' : 'All statuses'}</option>
            <option value="active">{ar ? 'نشط' : 'Active'}</option>
            <option value="completed">{ar ? 'مكتمل' : 'Completed'}</option>
            <option value="on_hold">{ar ? 'معلق' : 'On hold'}</option>
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.isError ? (
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void list.refetch()} />
        ) : isLoading ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ar ? 'جارٍ التحميل…' : 'Loading…'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground" data-testid="admin-projects-empty">
            {query || status !== 'all'
              ? (ar ? 'لا توجد مشاريع مطابقة لهذا البحث.' : 'No projects match this search.')
              : (ar ? 'لم يُنشأ أي مشروع بعد.' : 'No project has been created yet.')}
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
                      <Link href={`/admin/projects/${project.id}`} className="font-medium underline-offset-2 hover:underline">
                        {project.title || `#${project.id}`}
                      </Link>
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

        <Pager
          ar={ar} page={page} total={list.data?.total ?? null}
          pageCount={Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE))}
          onChange={setPage} testId="admin-projects-pager"
        />
      </CardContent>
    </Card>
  );
}
