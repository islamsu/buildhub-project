import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import {
  Users, FolderOpen, Package, FileText, ShieldCheck, AlertTriangle,
  TrendingUp, Settings, Search, Filter, Eye, Ban, CheckCircle2,
  MessageSquare, BarChart3, Shield, Flag, Activity, Globe
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { startLogin } from '@/const';
import { useState } from 'react';

// Mock analytics data
const MONTHLY_USERS = [
  { month: 'Jan', users: 120, projects: 45 },
  { month: 'Feb', users: 180, projects: 67 },
  { month: 'Mar', users: 250, projects: 89 },
  { month: 'Apr', users: 310, projects: 112 },
  { month: 'May', users: 420, projects: 145 },
  { month: 'Jun', users: 580, projects: 198 },
];

const MOCK_DISPUTES = [
  { id: 1, title: 'Payment not received', type: 'Payment', status: 'open', parties: 'Ahmed H. vs Mohamed C.', date: '2025-01-10', priority: 'high' },
  { id: 2, title: 'Work quality issue', type: 'Quality', status: 'investigating', parties: 'Sara K. vs Ali S.', date: '2025-01-08', priority: 'medium' },
  { id: 3, title: 'Delivery delay', type: 'Delivery', status: 'resolved', parties: 'Omar M. vs Nile Supplies', date: '2025-01-05', priority: 'low' },
  { id: 4, title: 'Fake reviews reported', type: 'Fraud', status: 'open', parties: 'Multiple users', date: '2025-01-12', priority: 'high' },
];

const MOCK_FRAUD_FLAGS = [
  { id: 1, user: 'contractor_xyz', reason: 'Multiple fake reviews detected', risk: 'high', date: '2025-01-12' },
  { id: 2, user: 'supplier_abc', reason: 'Suspicious pricing patterns', risk: 'medium', date: '2025-01-11' },
  { id: 3, user: 'user_123', reason: 'Multiple accounts from same IP', risk: 'high', date: '2025-01-10' },
];

export default function AdminDashboard() {
  const { t, lang } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [userSearch, setUserSearch] = useState('');

  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: isAuthenticated && (user as any)?.role === 'admin' });
  const { data: allUsers, refetch: refetchUsers } = trpc.admin.users.useQuery(undefined, { enabled: isAuthenticated && (user as any)?.role === 'admin' });
  const verifyUser = trpc.admin.verifyUser.useMutation({ onSuccess: () => { toast.success('User status updated'); refetchUsers(); } });

  if (loading) return null;
  if (!isAuthenticated) { startLogin(); return null; }
  if ((user as any)?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-destructive" />
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You do not have admin privileges.</p>
          <Button className="mt-4" onClick={() => navigate('/dashboard')}>Go to Dashboard</Button>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Users', value: stats?.users ?? 0, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50', trend: '+12%' },
    { label: 'Active Projects', value: stats?.projects ?? 0, icon: FolderOpen, color: 'text-green-500', bg: 'bg-green-50', trend: '+8%' },
    { label: 'Products Listed', value: stats?.products ?? 0, icon: Package, color: 'text-amber-500', bg: 'bg-amber-50', trend: '+24%' },
    { label: 'Open RFQs', value: stats?.rfqs ?? 0, icon: FileText, color: 'text-purple-500', bg: 'bg-purple-50', trend: '+5%' },
  ];

  const filteredUsers = allUsers?.filter(u =>
    !userSearch || u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-1">Admin Control Panel</h2>
            <p className="text-muted-foreground">Monitor and manage the BuildHub platform</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="badge-success text-xs px-3 py-1">Platform Healthy</Badge>
            <Badge className="badge-info text-xs px-3 py-1 flex items-center gap-1"><Activity className="w-3 h-3" /> Live</Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(s => (
            <Card key={s.label}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                    <s.icon className={`w-5 h-5 ${s.color}`} />
                  </div>
                  <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{s.trend}</span>
                </div>
                <p className="text-2xl font-bold">{s.value.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="users">
          <TabsList className="flex-wrap h-auto gap-1 mb-6">
            <TabsTrigger value="users" className="gap-1.5"><Users className="w-4 h-4" /> Users</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="w-4 h-4" /> Analytics</TabsTrigger>
            <TabsTrigger value="disputes" className="gap-1.5"><MessageSquare className="w-4 h-4" /> Disputes ({MOCK_DISPUTES.filter(d => d.status === 'open').length})</TabsTrigger>
            <TabsTrigger value="fraud" className="gap-1.5"><Shield className="w-4 h-4" /> Fraud Detection ({MOCK_FRAUD_FLAGS.length})</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5"><Settings className="w-4 h-4" /> Settings</TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> User Management</CardTitle>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9 h-9 text-sm" placeholder="Search users..." value={userSearch} onChange={e => setUserSearch(e.target.value)} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Name</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Email</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Role</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Joined</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers?.map(u => (
                        <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-2 font-medium">{u.name ?? '—'}</td>
                          <td className="py-3 px-2 text-muted-foreground">{u.email ?? '—'}</td>
                          <td className="py-3 px-2">
                            <Badge variant="secondary" className="capitalize text-xs">{(u as any).userRole ?? u.role}</Badge>
                          </td>
                          <td className="py-3 px-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${(u as any).verified ? 'badge-success' : 'badge-warning'}`}>
                              {(u as any).verified ? 'Verified' : 'Pending'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => verifyUser.mutate({ userId: u.id, verified: !(u as any).verified })}>
                                <ShieldCheck className="w-3 h-3" />
                                {(u as any).verified ? 'Unverify' : 'Verify'}
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => toast.info('Feature coming soon')}>
                                <Ban className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!filteredUsers || filteredUsers.length === 0) && (
                        <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No users found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">User Growth</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={MONTHLY_USERS}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="users" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Projects Created</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={MONTHLY_USERS}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="projects" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Platform Health Metrics</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Avg Response Time', value: '1.8h', icon: Activity, color: 'text-green-500' },
                      { label: 'Satisfaction Rate', value: '97.2%', icon: CheckCircle2, color: 'text-blue-500' },
                      { label: 'Active Regions', value: '12', icon: Globe, color: 'text-purple-500' },
                      { label: 'Open Disputes', value: MOCK_DISPUTES.filter(d => d.status === 'open').length, icon: Flag, color: 'text-amber-500' },
                    ].map(m => (
                      <div key={m.label} className="text-center p-4 rounded-xl bg-muted/30">
                        <m.icon className={`w-6 h-6 mx-auto mb-2 ${m.color}`} />
                        <p className="text-xl font-bold">{m.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Disputes Tab */}
          <TabsContent value="disputes">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> Dispute Management</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {MOCK_DISPUTES.map(d => (
                    <div key={d.id} className="p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-sm">{d.title}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.priority === 'high' ? 'badge-error' : d.priority === 'medium' ? 'badge-warning' : 'badge-info'}`}>{d.priority}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{d.parties}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>Type: {d.type}</span>
                            <span>Date: {d.date}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${d.status === 'resolved' ? 'badge-success' : d.status === 'investigating' ? 'badge-warning' : 'badge-error'}`}>{d.status}</span>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => toast.info('Dispute management coming soon')}>
                            <Eye className="w-3 h-3" /> Review
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Fraud Detection Tab */}
          <TabsContent value="fraud">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-destructive" /> Fraud Detection Alerts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {MOCK_FRAUD_FLAGS.map(f => (
                    <div key={f.id} className="p-4 rounded-xl border border-destructive/20 bg-destructive/5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
                            <h3 className="font-semibold text-sm">{f.user}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.risk === 'high' ? 'badge-error' : 'badge-warning'}`}>{f.risk} risk</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{f.reason}</p>
                          <p className="text-xs text-muted-foreground mt-1">Flagged: {f.date}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.info('Under investigation')}>Investigate</Button>
                          <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => toast.success('User suspended')}>
                            <Ban className="w-3 h-3" /> Suspend
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { title: 'Platform Settings', icon: Settings, items: ['Maintenance Mode', 'Registration Toggle', 'Email Notifications', 'SMS Alerts'] },
                { title: 'Verification Rules', icon: ShieldCheck, items: ['Auto-verify after KYC', 'Manual review threshold', 'Document requirements', 'Expiry periods'] },
                { title: 'Fee Configuration', icon: TrendingUp, items: ['Transaction fees', 'Subscription tiers', 'Featured listing costs', 'Commission rates'] },
                { title: 'Content Moderation', icon: Flag, items: ['Review approval flow', 'Spam detection sensitivity', 'Banned keywords', 'Report thresholds'] },
              ].map(section => (
                <Card key={section.title}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <section.icon className="w-4 h-4" /> {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {section.items.map(item => (
                        <div key={item} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <span className="text-sm">{item}</span>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toast.info('Settings coming soon')}>Configure</Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
