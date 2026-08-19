import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import MarketplaceHub from "./pages/MarketplaceHub";
import VendorsDirectory from "./pages/VendorsDirectory";
import DesignersDirectory from "./pages/DesignersDirectory";
import FinishingDirectory from "./pages/FinishingDirectory";
import AuthPage from "./pages/AuthPage";
import HomeownerDashboard from "./pages/HomeownerDashboard";
import ProviderDashboard from "./pages/ProviderDashboard";
import RolePlatform from "./pages/RolePlatform";
import AdminDashboard from "./pages/AdminDashboard";
import Marketplace from "./pages/Marketplace";
import ProductDetail from "./pages/ProductDetail";
import ProjectDetail from "./pages/ProjectDetail";
import RFQPage from "./pages/RFQPage";
import MessagesPage from "./pages/MessagesPage";
import AIAssistantPage from "./pages/AIAssistantPage";
import CompliancePage from "./pages/CompliancePage";
import PasswordSetupPage from "./pages/PasswordSetupPage";
import VendorProfile from "./pages/VendorProfile";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/auth"} component={AuthPage} />
      <Route path={"/dashboard"} component={HomeownerDashboard} />
      <Route path={"/provider"} component={ProviderDashboard} />
      <Route path={"/vendor/:id"} component={VendorProfile} />
      <Route path={"/platform/:role"} component={RolePlatform} />
      <Route path={"/admin/:section"} component={AdminDashboard} />
      <Route path={"/admin"} component={AdminDashboard} />
      <Route path={"/marketplace"} component={MarketplaceHub} />
      <Route path={"/marketplace/products"} component={Marketplace} />
      <Route path={"/marketplace/products/:id"} component={ProductDetail} />
      <Route path={"/marketplace/vendors/:id"} component={VendorsDirectory} />
      <Route path={"/marketplace/vendors"} component={VendorsDirectory} />
      <Route path={"/marketplace/designers/:id"} component={DesignersDirectory} />
      <Route path={"/marketplace/designers"} component={DesignersDirectory} />
      <Route path={"/marketplace/finishing/:id"} component={FinishingDirectory} />
      <Route path={"/marketplace/finishing"} component={FinishingDirectory} />
      <Route path={"/projects/:id"} component={ProjectDetail} />
      <Route path={"/rfq"} component={RFQPage} />
      <Route path={"/messages"} component={MessagesPage} />
      <Route path={"/compliance"} component={CompliancePage} />
      <Route path={"/auth/setup-password"} component={PasswordSetupPage} />
      <Route path={"/ai"} component={AIAssistantPage} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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
