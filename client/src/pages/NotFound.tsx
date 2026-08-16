import { Button } from "@/components/ui/button";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { lang, dir } = useLanguage();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-auto bg-gradient-to-br from-slate-50 to-slate-100 p-4" dir={dir}>
      <div className="absolute right-4 top-4 rtl:left-4 rtl:right-auto">
        <LanguageToggle />
      </div>
      <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center">
      <Card className="w-full max-w-lg mx-4 shadow-lg border-0 bg-white/80 backdrop-blur-sm">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-red-100 rounded-full animate-pulse" />
              <AlertCircle className="relative h-16 w-16 text-red-500" />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-slate-900 mb-2">404</h1>

          <h2 className="text-xl font-semibold text-slate-700 mb-4">
            {lang === 'ar' ? 'الصفحة غير موجودة' : 'Page Not Found'}
          </h2>

          <p className="text-slate-600 mb-8 leading-relaxed">
            {lang === 'ar' ? 'عذراً، الصفحة التي تبحث عنها غير موجودة.' : "Sorry, the page you are looking for doesn't exist."}
            <br />
            {lang === 'ar' ? 'ربما تم نقلها أو حذفها.' : 'It may have been moved or deleted.'}
          </p>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
            >
              <Home className="w-4 h-4 mr-2" />
              {lang === 'ar' ? 'العودة للرئيسية' : 'Go Home'}
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
