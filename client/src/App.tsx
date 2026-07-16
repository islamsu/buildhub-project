import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AuthPage from "./pages/AuthPage";
import HomeownerDashboard from "./pages/HomeownerDashboard";
import ProviderDashboard from "./pages/ProviderDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Marketplace from "./pages/Marketplace";
import ProjectDetail from "./pages/ProjectDetail";
import RFQPage from "./pages/RFQPage";
import MessagesPage from "./pages/MessagesPage";
import AIAssistantPage from "./pages/AIAssistantPage";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/auth"} component={AuthPage} />
      <Route path={"/dashboard"} component={HomeownerDashboard} />
      <Route path={"/provider"} component={ProviderDashboard} />
      <Route path={"/admin"} component={AdminDashboard} />
      <Route path={"/marketplace"} component={Marketplace} />
      <Route path={"/projects/:id"} component={ProjectDetail} />
      <Route path={"/rfq"} component={RFQPage} />
      <Route path={"/messages"} component={MessagesPage} />
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

