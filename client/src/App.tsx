import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch, useParams } from "wouter";
import { lazy, Suspense } from "react";

/**
 * ROUTE-LEVEL CODE SPLITTING.
 *
 * Every page was imported eagerly into the entry chunk, so a visitor landing
 * on the home page downloaded the admin dashboard, the compliance review
 * queue, the AI assistant and its markdown/syntax-highlighting stack before
 * anything rendered - 2469 KB raw, 676 KB gzipped.
 *
 * Home and AuthPage stay eager: they are the first and second thing almost
 * every visitor sees, and deferring them would trade a smaller download for a
 * visible blank frame on the page that matters most.
 */
const MarketplaceHub = lazy(() => import("./pages/MarketplaceHub"));
const VendorsDirectory = lazy(() => import("./pages/VendorsDirectory"));
const DesignersDirectory = lazy(() => import("./pages/DesignersDirectory"));
const FinishingDirectory = lazy(() => import("./pages/FinishingDirectory"));
const HomeownerDashboard = lazy(() => import("./pages/HomeownerDashboard"));
const ProviderDashboard = lazy(() => import("./pages/ProviderDashboard"));
const RolePlatform = lazy(() => import("./pages/RolePlatform"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminAcceptInvitation = lazy(() => import("./pages/AdminAcceptInvitation"));
const AdminAdmins = lazy(() => import("./pages/AdminAdmins"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const RFQPage = lazy(() => import("./pages/RFQPage"));
const RFQDetail = lazy(() => import("./pages/RFQDetail"));
const QuotationDetail = lazy(() => import("./pages/QuotationDetail"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const AIAssistantPage = lazy(() => import("./pages/AIAssistantPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const RFQRespondPage = lazy(() => import("./pages/RFQRespondPage"));
const ProductFormPage = lazy(() => import("./pages/ProductFormPage"));
/**
 * Named wrappers rather than `component={() => <ProductFormPage mode="…" />}`.
 *
 * An inline arrow is a NEW component identity on every render, so React
 * unmounts and remounts the page - losing form state mid-edit. It also hides
 * the route from scripts/inventory.mjs, whose parser matches
 * `component={Identifier}`: both product routes were silently absent from the
 * repository census until this was noticed.
 */
function NewProductPage() { return <ProductFormPage mode="create" />; }
function EditProductPage() {
  // Reads the param the ROUTE declares, rather than leaving
  // ProductFormPage to dig it out of the router itself. The repository
  // census flags a route that declares `:id` and never uses it, and it
  // was right to: an indirection the reader cannot follow is one a
  // refactor can quietly sever.
  const params = useParams<{ id?: string }>();
  return <ProductFormPage mode="edit" productId={Number(params.id)} />;
}
const CompliancePage = lazy(() => import("./pages/CompliancePage"));
const PasswordSetupPage = lazy(() => import("./pages/PasswordSetupPage"));
const PasswordResetPage = lazy(() => import("./pages/PasswordResetPage"));
const VendorProfile = lazy(() => import("./pages/VendorProfile"));
const Pricing = lazy(() => import("./pages/Pricing"));
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AuthPage from "./pages/AuthPage";

/**
 * What a visitor sees while a route's chunk arrives. Deliberately quiet: a
 * spinner that flashes for 80ms is worse than a brief empty frame, and the
 * chunks are small enough that this is rarely visible at all.
 */
function RouteFallback() {
  return <div className="min-h-screen bg-background" aria-busy="true" />;
}

/**
 * Sends the three legacy per-directory detail URLs to the one real provider
 * detail page. Every provider type - vendor, designer, finishing company - is a
 * row in the same users table and has always rendered through /vendor/:id, so
 * there is one destination, not three.
 *
 * `replace` so the dead URL does not sit in history: pressing Back from the
 * vendor page should return to wherever the visitor actually came from, not
 * bounce them through the redirect again.
 */
function RedirectToVendor() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/vendor/${id}`} replace />;
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/auth"} component={AuthPage} />
      <Route path={"/dashboard"} component={HomeownerDashboard} />
      <Route path={"/provider"} component={ProviderDashboard} />
      <Route path={"/vendor/:id"} component={VendorProfile} />
      <Route path={"/platform/:role"} component={RolePlatform} />
      {/* ORDER MATTERS. wouter takes the first match, and "/admin/:section"
          matches "/admin/login" - so these three have to come first or the
          admin sign-in page would render the dashboard's Access Denied screen
          to the very people trying to sign in. */}
      <Route path={"/admin/login"} component={AdminLogin} />
      <Route path={"/admin/accept-invitation"} component={AdminAcceptInvitation} />
      <Route path={"/admin/admins"} component={AdminAdmins} />
      <Route path={"/admin/:section"} component={AdminDashboard} />
      <Route path={"/admin"} component={AdminDashboard} />
      <Route path={"/pricing"} component={Pricing} />
      <Route path={"/marketplace"} component={MarketplaceHub} />
      <Route path={"/marketplace/products"} component={Marketplace} />
      <Route path={"/marketplace/products/:id"} component={ProductDetail} />
      {/* These three declared an :id and threw it away. Each rendered its
          directory - the full list - so a link to ONE vendor, designer or
          finishing company delivered a page listing all of them. It looked
          like navigation and was not. /vendor/:id is the canonical provider
          detail page and always was; these now redirect to it rather than
          being deleted, so existing links and bookmarks resolve to the record
          they name instead of 404ing. */}
      <Route path={"/marketplace/vendors/:id"} component={RedirectToVendor} />
      <Route path={"/marketplace/vendors"} component={VendorsDirectory} />
      <Route path={"/marketplace/designers/:id"} component={RedirectToVendor} />
      <Route path={"/marketplace/designers"} component={DesignersDirectory} />
      <Route path={"/marketplace/finishing/:id"} component={RedirectToVendor} />
      <Route path={"/marketplace/finishing"} component={FinishingDirectory} />
      <Route path={"/projects/:id"} component={ProjectDetail} />
      <Route path={"/rfq"} component={RFQPage} />
      <Route path={"/rfq/:id/respond"} component={RFQRespondPage} />
      <Route path={"/rfq/:id"} component={RFQDetail} />
      <Route path={"/quotations/:id"} component={QuotationDetail} />
      <Route path={"/messages"} component={MessagesPage} />
      <Route path={"/compliance"} component={CompliancePage} />
      <Route path={"/auth/setup-password"} component={PasswordSetupPage} />
      <Route path={"/auth/reset-password"} component={PasswordResetPage} />
      <Route path={"/products/new"} component={NewProductPage} />
      <Route path={"/products/:id/edit"} component={EditProductPage} />
      <Route path={"/settings"} component={SettingsPage} />
      <Route path={"/ai"} component={AIAssistantPage} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
