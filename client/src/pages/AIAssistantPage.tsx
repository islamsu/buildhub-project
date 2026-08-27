import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { AIChatBox, type Message } from '@/components/AIChatBox';
import { AIAttachmentControl, type UploadedAttachment } from '@/components/AIAttachmentControl';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Bot, Calculator, Layers, Lightbulb, TrendingUp, AlertTriangle, ShoppingCart, Wrench,
  ClipboardList, ClipboardCheck, Palette, HardHat, FileSearch, FileText, FileSpreadsheet,
  Search, Cpu, BookOpen, FlaskConical, Leaf, Package, PenLine, Repeat, GanttChart,
  CalendarClock, ArrowRight,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { experienceFor } from '@shared/aiRoles';

/**
 * ONE ENGINE, SIX EXPERIENCES.
 *
 * The tools, the heading and the shortcuts come from the role config; the
 * composer below them is identical for everyone and accepts any question. That
 * is the point of the split - personalisation decides what is OFFERED, never
 * what may be ASKED.
 *
 * The role is read from the authenticated session via auth.me. There is no
 * role prop, no query parameter and no local override, so there is nothing on
 * this page for a user to set: picking a different experience would require
 * changing who you are signed in as.
 */

/** Icon names in the shared config resolved to components here, not there. */
const ICONS: Record<string, typeof Bot> = {
  Bot, Calculator, Layers, Lightbulb, TrendingUp, AlertTriangle, ShoppingCart, Wrench,
  ClipboardList, ClipboardCheck, Palette, HardHat, FileSearch, FileText, FileSpreadsheet,
  Search, Cpu, BookOpen, FlaskConical, Leaf, Package, PenLine, Repeat, GanttChart,
  CalendarClock,
};

// No SYSTEM_PROMPT here on purpose. The server builds it - the source
// hierarchy, the BuildHub briefing derived from live product data, the role
// stance, and the rules the assistant may not break - and DISCARDS any system
// message a client sends. Grounding the browser could edit is not grounding.

export default function AIAssistantPage() {
  const { t, lang } = useLanguage();
  const { data: capabilities } = trpc.auth.capabilities.useQuery();
  const { data: me } = trpc.auth.me.useQuery();
  const aiUnavailable = capabilities?.aiAssistant === false;

  // THE AUTHENTICATED ROLE, from the session. An unknown role - a new enum
  // value, an admin, a signed-out visitor - falls back to the homeowner
  // experience rather than an error or an empty page.
  const experience = experienceFor(me?.userRole);

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: lang === 'ar' ? 'مرحباً! أنا BuildHub AI. اسألني عن أي شيء يخص البناء والتشطيب، أو اختر أداة من الأعلى.' : "Hello! I'm BuildHub AI. Ask me anything about construction, or pick one of the tools above." },
  ]);
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
    setAttachment(null);
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
            <h1 className="text-3xl font-bold mb-2" data-testid="ai-role-title">{t(experience.titleKey)}</h1>
            <p className="text-muted-foreground" data-testid="ai-role-subtitle">{t(experience.subtitleKey)}</p>
          </div>

          {aiUnavailable && (
            <div role="status" className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center">
              <p className="font-medium text-amber-700 dark:text-amber-400">{t('ai.unavailable.title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('ai.unavailable.body')}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="ai-tools">
            {experience.tools.map(mode => {
              const Icon = ICONS[mode.icon] ?? Bot;
              return (
                <Card
                  key={mode.id}
                  data-testid={`ai-tool-${mode.id}`}
                  aria-disabled={aiUnavailable}
                  className={`border-border ${aiUnavailable ? 'opacity-50 pointer-events-none' : 'card-hover cursor-pointer hover:border-primary/30'}`}
                  onClick={() => { if (!aiUnavailable) handleSend(t(mode.promptKey)); }}
                >
                  <CardContent className="p-4 text-center">
                    <Icon className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="text-sm font-medium">{t(mode.labelKey)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Real routes only. A button that goes nowhere teaches people the
              assistant's suggestions are decorative. */}
          <div className="flex flex-wrap gap-2 mb-8 justify-center" data-testid="ai-actions">
            {experience.actions.map(item => (
              <Button key={item.id} variant="outline" size="sm" asChild data-testid={`ai-action-${item.id}`}>
                <Link href={item.href} className="gap-1.5">
                  {t(item.labelKey)}
                  <ArrowRight className="size-3.5 rtl:rotate-180" />
                </Link>
              </Button>
            ))}
          </div>

          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            <AIChatBox
              messages={messages.filter(m => m.role !== 'system')}
              onSendMessage={handleSend}
              isLoading={chatMutation.isPending}
              disabled={aiUnavailable}
              placeholder={lang === 'ar' ? 'اسأل عن أي شيء في البناء والتشطيب...' : 'Ask anything about construction...'}
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
