import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  MessageSquare, Bell, Send, Paperclip, Search, CheckCheck,
  Clock, FileText, Image, MoreVertical, Phone, Video
} from 'lucide-react';

// Mock conversations for demonstration
const MOCK_CONVERSATIONS = [
  { id: 1, name: 'Ahmed Hassan (Contractor)', initials: 'AH', lastMessage: 'I can start the project next week', time: '10:30 AM', unread: 2, online: true, role: 'Contractor' },
  { id: 2, name: 'Sara Khalil (Architect)', initials: 'SK', lastMessage: 'Please review the updated drawings', time: 'Yesterday', unread: 0, online: false, role: 'Architect' },
  { id: 3, name: 'Mohamed Supplier', initials: 'MS', lastMessage: 'Quotation attached for the tiles', time: 'Mon', unread: 1, online: true, role: 'Supplier' },
  { id: 4, name: 'BuildHub Support', initials: 'BH', lastMessage: 'Your verification is complete!', time: 'Sun', unread: 0, online: true, role: 'Support' },
];

const MOCK_MESSAGES: Record<number, Array<{ id: number; from: 'me' | 'them'; content: string; time: string; type: 'text' | 'file' }>> = {
  1: [
    { id: 1, from: 'them', content: 'Hello! I saw your RFQ for the apartment renovation.', time: '10:00 AM', type: 'text' },
    { id: 2, from: 'me', content: 'Hi Ahmed! Yes, I need a contractor for a 150m² apartment finishing.', time: '10:05 AM', type: 'text' },
    { id: 3, from: 'them', content: 'I have 8 years of experience in residential finishing. Can you share the drawings?', time: '10:10 AM', type: 'text' },
    { id: 4, from: 'me', content: 'Sure, I will upload them to the project. What is your estimated timeline?', time: '10:15 AM', type: 'text' },
    { id: 5, from: 'them', content: 'I can start the project next week', time: '10:30 AM', type: 'text' },
  ],
  2: [
    { id: 1, from: 'them', content: 'I have completed the initial design concepts for your villa.', time: 'Yesterday 2:00 PM', type: 'text' },
    { id: 2, from: 'them', content: 'Please review the updated drawings', time: 'Yesterday 2:01 PM', type: 'file' },
  ],
  3: [
    { id: 1, from: 'them', content: 'We have the Italian marble tiles you requested in stock.', time: 'Mon 9:00 AM', type: 'text' },
    { id: 2, from: 'them', content: 'Quotation attached for the tiles', time: 'Mon 9:05 AM', type: 'file' },
  ],
  4: [
    { id: 1, from: 'them', content: 'Welcome to BuildHub! Your account has been created successfully.', time: 'Sun 8:00 AM', type: 'text' },
    { id: 2, from: 'them', content: 'Your verification is complete!', time: 'Sun 8:01 AM', type: 'text' },
  ],
};

export default function MessagesPage() {
  const { t, lang, dir } = useLanguage();
  const { isAuthenticated } = useAuth();
  const { data: notifications } = trpc.notifications.list.useQuery(undefined, { enabled: isAuthenticated });
  const markRead = trpc.notifications.markAllRead.useMutation({ onSuccess: () => toast.success(lang === 'ar' ? 'تم تحديد الكل كمقروء' : 'All marked as read') });

  const [selectedConv, setSelectedConv] = useState<number | null>(1);
  const [messageText, setMessageText] = useState('');
  const [localMessages, setLocalMessages] = useState(MOCK_MESSAGES);
  const [searchConv, setSearchConv] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConv, localMessages]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container pt-32 text-center">
          <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-2xl font-bold mb-2">{lang === 'ar' ? 'سجّل الدخول لعرض الرسائل' : 'Sign in to view messages'}</h2>
          <Button onClick={() => startLogin()} className="mt-4">{lang === 'ar' ? 'تسجيل الدخول' : 'Sign In'}</Button>
        </div>
      </div>
    );
  }

  const filteredConvs = MOCK_CONVERSATIONS.filter(c =>
    !searchConv || c.name.toLowerCase().includes(searchConv.toLowerCase())
  );

  const activeConv = MOCK_CONVERSATIONS.find(c => c.id === selectedConv);
  const activeMessages = selectedConv ? (localMessages[selectedConv] ?? []) : [];

  const sendMessage = () => {
    if (!messageText.trim() || !selectedConv) return;
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    setLocalMessages(prev => ({
      ...prev,
      [selectedConv]: [...(prev[selectedConv] ?? []), { id: Date.now(), from: 'me', content: messageText.trim(), time: now, type: 'text' }],
    }));
    setMessageText('');
  };

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <Navbar />
      <div className="container pt-24 pb-16">
        <h1 className="text-3xl font-bold mb-6">{t('dash.messages')} & {t('dash.notifications')}</h1>
        <Tabs defaultValue="messages">
          <TabsList className="mb-6">
            <TabsTrigger value="messages" className="gap-2">
              <MessageSquare className="w-4 h-4" /> {t('dash.messages')}
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="w-4 h-4" /> {t('dash.notifications')}
              {(notifications?.filter(n => !n.read).length ?? 0) > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0">
                  {notifications!.filter(n => !n.read).length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Messages Tab */}
          <TabsContent value="messages">
            <div className="border border-border rounded-2xl overflow-hidden h-[600px] flex">
              {/* Conversation List */}
              <div className="w-80 border-r border-border flex flex-col flex-shrink-0">
                <div className="p-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9 h-9 text-sm" placeholder={lang === 'ar' ? 'بحث في المحادثات...' : 'Search conversations...'} value={searchConv} onChange={e => setSearchConv(e.target.value)} />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {filteredConvs.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => setSelectedConv(conv.id)}
                      className={`w-full p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left ${selectedConv === conv.id ? 'bg-primary/5 border-r-2 border-primary' : ''}`}
                    >
                      <div className="relative flex-shrink-0">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback className="text-xs font-semibold gradient-brand text-white">{conv.initials}</AvatarFallback>
                        </Avatar>
                        {conv.online && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-sm font-medium truncate">{conv.name}</p>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{conv.time}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                          {conv.unread > 0 && (
                            <Badge className="text-xs px-1.5 py-0 h-4 ml-1 flex-shrink-0">{conv.unread}</Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat Area */}
              {activeConv ? (
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Chat Header */}
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="w-9 h-9">
                          <AvatarFallback className="text-xs font-semibold gradient-brand text-white">{activeConv.initials}</AvatarFallback>
                        </Avatar>
                        {activeConv.online && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-background" />}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{activeConv.name}</p>
                        <p className="text-xs text-muted-foreground">{activeConv.online ? (lang === 'ar' ? 'متصل الآن' : 'Online now') : (lang === 'ar' ? 'غير متصل' : 'Offline')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="w-8 h-8 p-0" onClick={() => toast.info(lang === 'ar' ? 'قريباً' : 'Coming soon')}><Phone className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="w-8 h-8 p-0" onClick={() => toast.info(lang === 'ar' ? 'قريباً' : 'Coming soon')}><Video className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" className="w-8 h-8 p-0"><MoreVertical className="w-4 h-4" /></Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {activeMessages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs lg:max-w-md ${msg.from === 'me' ? 'order-2' : ''}`}>
                          <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                            msg.from === 'me'
                              ? 'gradient-brand text-white rounded-br-sm'
                              : 'bg-muted text-foreground rounded-bl-sm'
                          }`}>
                            {msg.type === 'file' ? (
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 flex-shrink-0" />
                                <span>{msg.content}</span>
                              </div>
                            ) : msg.content}
                          </div>
                          <div className={`flex items-center gap-1 mt-1 ${msg.from === 'me' ? 'justify-end' : ''}`}>
                            <span className="text-xs text-muted-foreground">{msg.time}</span>
                            {msg.from === 'me' && <CheckCheck className="w-3 h-3 text-primary" />}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <div className="p-3 border-t border-border">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="w-9 h-9 p-0 flex-shrink-0" onClick={() => toast.info(lang === 'ar' ? 'قريباً' : 'File sharing coming soon')}>
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <Input
                        className="flex-1 h-9"
                        placeholder={lang === 'ar' ? 'اكتب رسالة...' : 'Type a message...'}
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      />
                      <Button size="sm" className="w-9 h-9 p-0 flex-shrink-0" onClick={sendMessage} disabled={!messageText.trim()}>
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>{lang === 'ar' ? 'اختر محادثة للبدء' : 'Select a conversation to start'}</p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <div className="flex justify-end mb-4">
              <Button variant="outline" size="sm" onClick={() => markRead.mutate()}>{lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}</Button>
            </div>
            <div className="space-y-3">
              {(!notifications || notifications.length === 0) && (
                <div className="text-center py-16 text-muted-foreground">
                  <Bell className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>{lang === 'ar' ? 'لا توجد إشعارات بعد' : 'No notifications yet'}</p>
                </div>
              )}
              {notifications?.map(n => (
                <Card key={n.id} className={`transition-colors ${!n.read ? 'border-primary/30 bg-primary/5' : ''}`}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!n.read ? 'bg-primary' : 'bg-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{n.title}</p>
                      {n.body && <p className="text-muted-foreground text-sm mt-0.5">{n.body}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
