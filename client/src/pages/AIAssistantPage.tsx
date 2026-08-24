import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { AIChatBox, type Message } from '@/components/AIChatBox';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, Calculator, Layers, Lightbulb, TrendingUp, AlertTriangle, ShoppingCart, Wrench } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { toast } from 'sonner';

const AI_MODES = [
  { icon: Calculator, label: 'Cost Estimator', prompt: 'Help me estimate the cost of my construction project', color: 'text-blue-500' },
  { icon: Layers, label: 'Quantity Surveyor', prompt: 'Calculate material quantities for my project', color: 'text-green-500' },
  { icon: Lightbulb, label: 'Material Advisor', prompt: 'Recommend the best materials for my project', color: 'text-amber-500' },
  { icon: TrendingUp, label: 'Project Manager', prompt: 'Help me plan and schedule my construction project', color: 'text-purple-500' },
  { icon: AlertTriangle, label: 'Risk Detector', prompt: 'Identify potential risks and delays in my project', color: 'text-red-500' },
  { icon: ShoppingCart, label: 'Procurement', prompt: 'Help me optimize my procurement strategy', color: 'text-indigo-500' },
  { icon: Wrench, label: 'Maintenance', prompt: 'Create a maintenance schedule for my property', color: 'text-orange-500' },
  { icon: Bot, label: 'General Consultant', prompt: 'I have a general question about construction', color: 'text-teal-500' },
];

const SYSTEM_PROMPT = `You are BuildHub AI — an expert construction and home improvement assistant. You help users with:
- Cost estimation and quantity surveying for construction projects in Egypt and the GCC
- Material selection and recommendations (local and international brands)
- Project planning, scheduling, and risk assessment
- Procurement advice and vendor evaluation
- Building regulations and best practices
- Interior design and finishing guidance

Always provide practical, actionable advice. When estimating costs, mention that prices are approximate and vary by location. Be concise but thorough. Support both English and Arabic queries.`;

export default function AIAssistantPage() {
  const { t, lang } = useLanguage();
  // Ask before offering. Every card below is the same ai.chat mutation, so on a
  // deployment with no provider credential all eight of them fail identically -
  // which is exactly what happened on staging: the page rendered perfectly and
  // nothing on it worked. `undefined` while the query is in flight, so the
  // tools stay enabled until we actually know otherwise.
  const { data: capabilities } = trpc.auth.capabilities.useQuery();
  const aiUnavailable = capabilities?.aiAssistant === false;
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'assistant', content: lang === 'ar' ? 'مرحباً! أنا BuildHub AI. يمكنني مساعدتك في تقدير التكاليف واختيار المواد وتخطيط المشاريع وتقييم المخاطر والمزيد. بماذا تريد أن تعرف؟' : "Hello! I'm BuildHub AI. I can help you with cost estimation, material selection, project planning, risk assessment, and much more. What would you like to know?" },
  ]);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (response: { content: string }) => {
      setMessages(prev => [...prev, { role: 'assistant', content: response.content }]);
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const handleSend = (content: string) => {
    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    chatMutation.mutate({ messages: newMessages });
  };

  const handleModeClick = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container pt-24 pb-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              <Bot className="w-4 h-4" />
              {t('dash.ai')}
            </div>
            <h1 className="text-3xl font-bold mb-2">{lang === 'ar' ? 'خبيرك في البناء بالذكاء الاصطناعي' : 'Your AI Construction Expert'}</h1>
            <p className="text-muted-foreground">{lang === 'ar' ? 'اسأل عن أي شيء: تقدير التكاليف، المواد، إدارة المشاريع...' : 'Ask anything about cost estimation, materials, project planning, and more'}</p>
          </div>

          {aiUnavailable && (
            <div role="status" className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center">
              <p className="font-medium text-amber-700 dark:text-amber-400">{t('ai.unavailable.title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('ai.unavailable.body')}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {AI_MODES.map((mode) => (
              <Card
                key={mode.label}
                aria-disabled={aiUnavailable}
                className={`border-border ${aiUnavailable ? 'opacity-50 pointer-events-none' : 'card-hover cursor-pointer hover:border-primary/30'}`}
                onClick={() => { if (!aiUnavailable) handleModeClick(mode.prompt); }}
              >
                <CardContent className="p-4 text-center">
                  <mode.icon className={`w-6 h-6 mx-auto mb-2 ${mode.color}`} />
                  <p className="text-sm font-medium">{mode.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <AIChatBox
              messages={messages.filter(m => m.role !== 'system')}
              onSendMessage={handleSend}
              isLoading={chatMutation.isPending}
              disabled={aiUnavailable}
              placeholder={lang === 'ar' ? 'اسأل عن التكاليف، المواد، تخطيط المشاريع...' : 'Ask about costs, materials, project planning...'}
              suggestedPrompts={[
                'Estimate cost for a 200m² apartment finishing',
                'What materials do I need for a kitchen renovation?',
                'How do I manage a construction project timeline?',
                'What are common construction risks in Egypt?',
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
