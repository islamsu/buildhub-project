import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { AIChatBox, type Message } from '@/components/AIChatBox';
import { AIAttachmentControl, type UploadedAttachment } from '@/components/AIAttachmentControl';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, Calculator, Layers, Lightbulb, TrendingUp, AlertTriangle, ShoppingCart, Wrench } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { toast } from 'sonner';

// The eight tools. `labelKey` and `promptKey` rather than literals: the tool
// names used to render in English on an Arabic page, and the opening prompt was
// sent in English no matter which language the person had chosen.
const AI_MODES = [
  { icon: Calculator, labelKey: 'ai.mode.cost', promptKey: 'ai.mode.cost.prompt', color: 'text-blue-500' },
  { icon: Layers, labelKey: 'ai.mode.quantity', promptKey: 'ai.mode.quantity.prompt', color: 'text-green-500' },
  { icon: Lightbulb, labelKey: 'ai.mode.material', promptKey: 'ai.mode.material.prompt', color: 'text-amber-500' },
  { icon: TrendingUp, labelKey: 'ai.mode.pm', promptKey: 'ai.mode.pm.prompt', color: 'text-purple-500' },
  { icon: AlertTriangle, labelKey: 'ai.mode.risk', promptKey: 'ai.mode.risk.prompt', color: 'text-red-500' },
  { icon: ShoppingCart, labelKey: 'ai.mode.procurement', promptKey: 'ai.mode.procurement.prompt', color: 'text-indigo-500' },
  { icon: Wrench, labelKey: 'ai.mode.maintenance', promptKey: 'ai.mode.maintenance.prompt', color: 'text-orange-500' },
  { icon: Bot, labelKey: 'ai.mode.general', promptKey: 'ai.mode.general.prompt', color: 'text-teal-500' },
];

// No SYSTEM_PROMPT here on purpose. The server builds it - the source
// hierarchy, the BuildHub briefing derived from live product data, and the
// rules the assistant may not break - and DISCARDS any system message a client
// sends. Grounding that the browser could edit is not grounding.

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
    { role: 'assistant', content: lang === 'ar' ? 'مرحباً! أنا BuildHub AI. يمكنني مساعدتك في تقدير التكاليف واختيار المواد وتخطيط المشاريع وتقييم المخاطر والمزيد. بماذا تريد أن تعرف؟' : "Hello! I'm BuildHub AI. I can help you with cost estimation, material selection, project planning, risk assessment, and much more. What would you like to know?" },
  ]);

  // The attachment belongs to the NEXT message, so it lives here rather than
  // inside the composer: sending has to clear it, and a mode card that fires a
  // canned prompt must carry it too.
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);

  const chatMutation = trpc.ai.chat.useMutation({
    onSuccess: (response: { content: string }) => {
      setMessages(prev => [...prev, { role: 'assistant', content: response.content }]);
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const handleSend = (content: string) => {
    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    chatMutation.mutate({
      messages: newMessages,
      lang,
      ...(attachment ? { attachmentIds: [attachment.id] } : {}),
    });
    // Cleared once sent. The file stays with the turn it was asked about; a
    // sticky attachment would silently re-attach itself to every later
    // question, and the model would keep answering about a file the person
    // stopped talking about.
    setAttachment(null);
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
                key={mode.labelKey}
                aria-disabled={aiUnavailable}
                className={`border-border ${aiUnavailable ? 'opacity-50 pointer-events-none' : 'card-hover cursor-pointer hover:border-primary/30'}`}
                onClick={() => { if (!aiUnavailable) handleModeClick(t(mode.promptKey)); }}
              >
                <CardContent className="p-4 text-center">
                  <mode.icon className={`w-6 h-6 mx-auto mb-2 ${mode.color}`} />
                  <p className="text-sm font-medium">{t(mode.labelKey)}</p>
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
                t('ai.suggestion.1'),
                t('ai.suggestion.2'),
                t('ai.suggestion.3'),
              ]}
              composerSlot={(
                <AIAttachmentControl
                  attachment={attachment}
                  onAttached={setAttachment}
                  onCleared={() => setAttachment(null)}
                  disabled={aiUnavailable}
                />
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
