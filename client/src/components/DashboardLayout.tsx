import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { useLanguage } from "@/contexts/LanguageContext";
import { LayoutDashboard, LogOut, PanelLeft, Users, FolderOpen, ShoppingBag, FileText, MessageSquare, Bot, Settings, BarChart3, Shield, Building2, Package, BriefcaseBusiness, ClipboardList, PenTool, Truck, KanbanSquare, CreditCard } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import LanguageToggle from "./LanguageToggle";
import { workspaceHref, type SectionId, type WorkspaceRole } from "@shared/roleWorkspaceSections";
import { useHashSection, revealSection } from "@/hooks/useSectionAnchor";

/**
 * THE ROLE MENUS.
 *
 * Every entry names a destination. Where that destination is a section of the
 * role workspace, the entry carries the section id and the href is built by
 * `workspaceHref`, which refuses to produce an anchor for a section the role
 * does not render. Four contractor entries, three supplier entries and four
 * project-manager entries used to share the bare `/platform/:role` path: they
 * all rendered as active at the same time and clicking any of them did
 * nothing. See shared/roleWorkspaceSections.ts.
 *
 * An entry with no destination is not listed. "Reviews" pointed at /messages
 * and "Settings" at the workspace root; reviews are written on a completed
 * project and there is no settings page, so neither is advertised as a place
 * to go. Editing your own profile IS real, so it is listed as Profile and
 * points at the section that holds the editor.
 */
type MenuItem = {
  icon: typeof LayoutDashboard;
  labelKey: string;
  path: string;
  section?: SectionId;
};

const COMPLIANCE_MENU_ITEM = { icon: Shield, labelKey: 'platform.compliance', path: '/compliance' } as const;

function workspaceItem(role: WorkspaceRole, icon: typeof LayoutDashboard, labelKey: string, section: SectionId): MenuItem {
  return { icon, labelKey, path: workspaceHref(role, section), section };
}

const HOMEOWNER_MENU_KEYS: MenuItem[] = [
  workspaceItem('homeowner', LayoutDashboard, 'dash.overview', 'role-overview'),
  { icon: FolderOpen, labelKey: 'dash.projects', path: '/dashboard' },
  { icon: ShoppingBag, labelKey: 'nav.marketplace', path: '/marketplace' },
  { icon: FileText, labelKey: 'dash.get_quotes', path: '/rfq' },
  { icon: MessageSquare, labelKey: 'dash.messages', path: '/messages' },
  { icon: Bot, labelKey: 'dash.ai', path: '/ai' },
  workspaceItem('homeowner', Settings, 'profile.title', 'role-profile'),
];

const ROLE_MENU_KEYS: Record<WorkspaceRole, MenuItem[]> = {
  homeowner: HOMEOWNER_MENU_KEYS,
  contractor: [
    workspaceItem('contractor', LayoutDashboard, 'dash.overview', 'role-overview'),
    COMPLIANCE_MENU_ITEM,
    workspaceItem('contractor', ClipboardList, 'platform.pipeline', 'role-pipeline'),
    workspaceItem('contractor', FileText, 'platform.my_quotations', 'role-quotations'),
    { icon: FileText, labelKey: 'provider.open_rfqs', path: '/rfq' },
    workspaceItem('contractor', FolderOpen, 'platform.projects', 'role-projects'),
    { icon: MessageSquare, labelKey: 'dash.messages', path: '/messages' },
    workspaceItem('contractor', BarChart3, 'platform.performance', 'role-performance'),
  ],
  engineer: [
    workspaceItem('engineer', LayoutDashboard, 'dash.overview', 'role-overview'),
    COMPLIANCE_MENU_ITEM,
    workspaceItem('engineer', PenTool, 'platform.documents', 'role-documents'),
    workspaceItem('engineer', FileText, 'platform.my_quotations', 'role-quotations'),
    workspaceItem('engineer', BriefcaseBusiness, 'platform.project_queue', 'role-projects'),
    { icon: FileText, labelKey: 'provider.open_rfqs', path: '/rfq' },
    { icon: MessageSquare, labelKey: 'dash.messages', path: '/messages' },
    workspaceItem('engineer', BarChart3, 'platform.performance', 'role-performance'),
  ],
  architect: [
    workspaceItem('architect', LayoutDashboard, 'dash.overview', 'role-overview'),
    COMPLIANCE_MENU_ITEM,
    workspaceItem('architect', PenTool, 'platform.portfolio', 'role-portfolio'),
    workspaceItem('architect', FileText, 'platform.my_quotations', 'role-quotations'),
    workspaceItem('architect', FolderOpen, 'platform.projects', 'role-projects'),
    { icon: FileText, labelKey: 'provider.open_rfqs', path: '/rfq' },
    { icon: MessageSquare, labelKey: 'dash.messages', path: '/messages' },
    workspaceItem('architect', BarChart3, 'platform.performance', 'role-performance'),
  ],
  supplier: [
    workspaceItem('supplier', LayoutDashboard, 'dash.overview', 'role-overview'),
    COMPLIANCE_MENU_ITEM,
    workspaceItem('supplier', Package, 'platform.catalogue', 'role-catalogue'),
    workspaceItem('supplier', FileText, 'platform.my_quotations', 'role-quotations'),
    { icon: ClipboardList, labelKey: 'platform.review_requests', path: '/rfq' },
    { icon: ShoppingBag, labelKey: 'nav.marketplace', path: '/marketplace/products' },
    { icon: MessageSquare, labelKey: 'dash.messages', path: '/messages' },
    workspaceItem('supplier', BarChart3, 'platform.performance', 'role-performance'),
  ],
  project_manager: [
    workspaceItem('project_manager', LayoutDashboard, 'dash.overview', 'role-overview'),
    COMPLIANCE_MENU_ITEM,
    workspaceItem('project_manager', KanbanSquare, 'platform.project_queue', 'role-queue'),
    { icon: FileText, labelKey: 'provider.open_rfqs', path: '/rfq' },
    { icon: Users, labelKey: 'platform.team', path: '/messages' },
    workspaceItem('project_manager', BarChart3, 'platform.performance', 'role-performance'),
  ],
};

const ADMIN_MENU_KEYS: MenuItem[] = [
  { icon: LayoutDashboard, labelKey: 'admin.title', path: '/admin' },
  { icon: Users, labelKey: 'admin.users', path: '/admin/users' },
  { icon: Shield, labelKey: 'admin.pending_verifications', path: '/admin/compliance' },
  { icon: FileText, labelKey: 'admin.disputes', path: '/admin/disputes' },
  { icon: BarChart3, labelKey: 'admin.analytics', path: '/admin/analytics' },
  { icon: CreditCard, labelKey: 'adminBilling.title', path: '/admin/billing' },
  { icon: Settings, labelKey: 'dash.settings', path: '/admin/settings' },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  const { t } = useLanguage();
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              {t('auth.signin')}
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {t('auth.tagline')}
            </p>
          </div>
          <Button
            onClick={() => { window.location.href = '/auth?mode=login'; }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            {t('nav.signin')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const userRole = (user as any)?.userRole ?? 'homeowner';
  // ONLY the authorization column decides the admin menu. `userRole` is a
  // marketplace role chosen by the user; reading it here meant a self-assigned
  // value could render admin navigation on an account with no admin rights.
  // Every link behind it failed server-side, so nothing leaked - but a menu
  // that misrepresents an account is its own problem, and a UI control keyed
  // on user-supplied data is the habit worth removing, not the symptom.
  const menuKeys = user?.role === 'admin'
    ? ADMIN_MENU_KEYS
    : ROLE_MENU_KEYS[userRole as keyof typeof ROLE_MENU_KEYS] ?? HOMEOWNER_MENU_KEYS;
  const menuItems = menuKeys.map(item => ({ ...item, label: t(item.labelKey) }));

  // WHICH ITEM IS ACTUALLY CURRENT.
  //
  // `location` is the path alone, so comparing it to a menu path marked every
  // workspace entry active at once - Overview, Pipeline, Projects and
  // Performance all lit up together on /platform/contractor. The section in
  // the address bar is what separates them.
  const hashSection = useHashSection();
  const isCurrent = (item: MenuItem) => {
    const [itemPath] = item.path.split('#');
    if (itemPath !== location) return false;
    if (!item.section) return true;
    // With no section in the URL the workspace is showing its top, which is
    // what Overview means; every other section entry is inactive.
    return hashSection ? item.section === hashSection : item.section === 'role-overview';
  };
  const activeMenuItem = menuItems.find(isCurrent);

  /**
   * Going to a section of the page you are already on.
   *
   * setLocation cannot express this: wouter compares paths, so navigating from
   * /platform/supplier to /platform/supplier#role-catalogue is a no-op to the
   * router and the click produces nothing at all. Pushing the hash directly and
   * announcing it keeps back/forward working and gives the click a visible
   * consequence even when the section is already on screen.
   */
  const goTo = (item: MenuItem) => {
    const [itemPath, itemHash] = item.path.split('#');
    if (itemPath !== location) { setLocation(item.path); return; }
    const next = itemHash ? `${itemPath}#${itemHash}` : itemPath;
    if (window.location.pathname + window.location.hash !== next) {
      window.history.pushState(null, '', next);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    if (itemHash) revealSection(itemHash);
  };

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="font-bold tracking-tight truncate text-primary">BuildHub</span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = isCurrent(item);
                return (
                  <SidebarMenuItem key={`${item.path}-${item.labelKey}`}>
                    <SidebarMenuButton
                      isActive={isActive}
                      aria-current={isActive ? 'page' : undefined}
                      data-testid={`nav-${item.labelKey}`}
                      onClick={() => goTo(item)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <LanguageToggle
              showLabel={!isCollapsed}
              className="mb-2 w-full justify-start group-data-[collapsible=icon]:justify-center"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={logout}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{t('nav.logout')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? t('dash.overview')}
                  </span>
                </div>
              </div>
            </div>
            <LanguageToggle showLabel={false} className="h-9 w-9 shrink-0" />
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-x-visible p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
