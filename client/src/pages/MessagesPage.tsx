import { useLanguage } from '@/contexts/LanguageContext';
import Navbar from '@/components/Navbar';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notificationText } from '@/lib/notificationText';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Link } from 'wouter';
import {
  MessageSquare, Bell, Send, Paperclip, Search, CheckCheck,
  Clock, FileText, Image,
} from 'lucide-react';

/**
 * REMOVED: MOCK_CONVERSATIONS and MOCK_MESSAGES.
 *
 * This page shipped four fabricated conversations - invented people ("Ahmed
 * Hassan (Contractor)", "Sara Khalil (Architect)"), invented message threads,
 * invented unread badges and a green "Online now" dot - and rendered them to
 * any signed-in user who had no real conversations yet:
 *
 *     conversations = persisted.length > 0 ? persisted : MOCK_CONVERSATIONS
 *
 * Two things followed from that, and the second is the serious one.
 *
 * It fabricated a platform statement. One mock thread contained "Your
 * verification is complete!" attributed to "BuildHub Support". A real supplier
 * waiting on verification could read that as BuildHub telling them they had
 * been approved.
 *
 * It MISDIRECTED REAL MESSAGES. The mock ids were 1-4 and selectedConv
 * defaulted to 1, so typing into the thread labelled "Ahmed Hassan" fired
 * messages.send({ receiverId: 1 }) - delivering the text to whichever real
 * account holds user id 1. The server has been fixed to require a real active
 * recipient, and the fabricated list that pointed at those ids is gone.
 *
 * An empty inbox now says it is empty, which is the honest thing for it to say.
 */

export default function MessagesPage() {
  const { t, lang, dir } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const { data: notifications } = trpc.notifications.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: persistedConversations = [] } = trpc.messages.conversations.useQuery(undefined, { enabled: isAuthenticated });
  const markRead = trpc.notifications.markAllRead.useMutation({ onSuccess: () => toast.success(lang === 'ar' ? 'تم تحديد الكل كمقروء' : 'All marked as read') });

  // Was `useState(1)`. A default of 1 is a real user id, and combined with the
  // fabricated conversation list it aimed the composer at that account.
  const [selectedConv, setSelectedConv] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [searchConv, setSearchConv] = useState('');
  const [quotationId, setQuotationId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: persistedMessages = [], refetch: refetchMessages } = trpc.messages.list.useQuery({ otherUserId: selectedConv ?? undefined }, { enabled: isAuthenticated && selectedConv !== null });
  const sendMutation = trpc.messages.send.useMutation({ onSuccess: () => refetchMessages(), onError: error => toast.error(error.message) });
  const uploadMutation = trpc.messages.uploadAttachment.useMutation({ onError: error => toast.error(error.message) });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConv, persistedMessages]);

  useEffect(() => {
    if (persistedConversations.length > 0 && !persistedConversations.some(conversation => conversation.id === selectedConv)) setSelectedConv(persistedConversations[0].id);
  }, [persistedConversations, selectedConv]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container pt-32 text-center">
          <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-2xl font-bold mb-2">{lang === 'ar' ? 'سجّل الدخول لعرض الرسائل' : 'Sign in to view messages'}</h2>
          <Button onClick={() => { window.location.href = '/auth?mode=login'; }} className="mt-4">{lang === 'ar' ? 'تسجيل الدخول' : 'Sign In'}</Button>
        </div>
      </div>
    );
  }

  const conversations = persistedConversations;
  const filteredConvs = conversations.filter(c =>
    !searchConv || c.name.toLowerCase().includes(searchConv.toLowerCase())
  );

  const activeConv = conversations.find(c => c.id === selectedConv);
  const persistedDisplayMessages = persistedMessages.map(message => ({ id: message.id, from: message.senderId === (user as any)?.id ? 'me' as const : 'them' as const, content: message.content, time: new Date(message.createdAt).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' }), type: message.type === 'text' ? 'text' as const : 'file' as const, fileUrl: message.fileUrl ?? undefined, quotationId: message.quotationId ?? undefined }));
  const activeMessages = persistedDisplayMessages;

  const sendMessage = () => {
    if (!messageText.trim() || !selectedConv) return;
    const content = messageText.trim();
    // No optimistic append. It used to run unconditionally, so a message the
    // server REFUSED still appeared in the thread as though it had been sent.
    // refetchMessages() on success is the only thing that puts it on screen.
    sendMutation.mutate({ receiverId: selectedConv, content, type: 'text' });
    setMessageText('');
  };

    const shareQuotation = () => {
    if (!selectedConv || !quotationId.trim()) { toast.error(lang === 'ar' ? 'أدخل رقم عرض السعر' : 'Enter a quotation ID'); return; }
    const content = lang === 'ar' ? `تمت مشاركة عرض السعر #${quotationId}` : `Quotation #${quotationId} shared for review`;
    sendMutation.mutate({ receiverId: selectedConv, content, type: 'quotation', quotationId: Number(quotationId) });
    setQuotationId('');
  };


  const handleFile = (file?: File) => {
    if (!file || !selectedConv) return;
    if (file.size > 8 * 1024 * 1024 || !(file.type.startsWith('image/') || file.type === 'application/pdf')) {
      toast.error(lang === 'ar' ? 'يسمح بصور وملفات PDF حتى 8 ميجابايت' : 'Images and PDFs up to 8MB are supported');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? '';
      uploadMutation.mutate({ fileName: file.name, contentType: file.type as 'application/pdf', base64 }, { onSuccess: attachment => { sendMutation.mutate({ receiverId: selectedConv, content: attachment.name, type: 'file', fileUrl: attachment.url }); } });
    };
    reader.readAsDataURL(file);
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
                  {filteredConvs.length === 0 && (
                    <p className="p-4 text-xs text-muted-foreground text-center">
                      {searchConv
                        ? (lang === 'ar' ? 'لا توجد محادثات مطابقة' : 'No conversations match that search')
                        : (lang === 'ar' ? 'لا توجد محادثات بعد' : 'No conversations yet')}
                    </p>
                  )}
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
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{activeConv.name}</p>
                        <p className="text-xs text-muted-foreground">{activeConv.role}</p>
                      </div>
                    </div>
                    {/* The voice-call, video-call and overflow buttons that sat
                        here did nothing: two toasted "Coming soon" and the third
                        had no handler at all. BuildHub has no calling feature, so
                        the honest thing is not to offer the control. */}
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
                                {msg.fileUrl ? <a className="underline underline-offset-2" href={msg.fileUrl} target="_blank" rel="noreferrer">{msg.content}</a> : msg.quotationId ? <a className="underline underline-offset-2" href={`/rfq?quotation=${msg.quotationId}`}>{msg.content}</a> : <span>{msg.content}</span>}
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
                      <Button variant="ghost" size="sm" className="w-9 h-9 p-0 flex-shrink-0" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={event => handleFile(event.target.files?.[0])} />
                      <Input className="h-9 w-24 text-xs" inputMode="numeric" placeholder={lang === 'ar' ? 'رقم العرض' : 'Quote ID'} value={quotationId} onChange={event => setQuotationId(event.target.value.replace(/\D/g, ''))} aria-label={lang === 'ar' ? 'رقم عرض السعر' : 'Quotation ID'} />
                      <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={shareQuotation} disabled={sendMutation.isPending || !quotationId}>{lang === 'ar' ? 'مشاركة عرض' : 'Share quote'}</Button>
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
                <div className="flex-1 flex items-center justify-center text-muted-foreground p-6">
                  {/* Two DIFFERENT empty states. "Select a conversation" was
                      shown even when there were none to select, which is a dead
                      end: it tells you to do something the screen cannot do. */}
                  {conversations.length === 0 ? (
                    <div className="text-center max-w-sm">
                      <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium text-foreground mb-1">
                        {lang === 'ar' ? 'لا توجد رسائل بعد' : 'No messages yet'}
                      </p>
                      <p className="text-sm mb-4">
                        {lang === 'ar'
                          ? 'تبدأ المحادثات عندما تتواصل مع مورّد من السوق أو عندما يرد أحدهم على طلب عرض سعر خاص بك.'
                          : 'Conversations start when you contact a vendor from the marketplace, or when someone responds to one of your requests for quotation.'}
                      </p>
                      <Link href="/marketplace/vendors">
                        <Button size="sm" data-testid="messages-empty-browse">
                          {lang === 'ar' ? 'تصفح المورّدين' : 'Browse vendors'}
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <div className="text-center">
                      <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>{lang === 'ar' ? 'اختر محادثة للبدء' : 'Select a conversation to start'}</p>
                    </div>
                  )}
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
              {notifications?.map(n => {
                const text = notificationText(n, t);
                return (
                <Card key={n.id} className={`transition-colors ${!n.read ? 'border-primary/30 bg-primary/5' : ''}`}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!n.read ? 'bg-primary' : 'bg-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{text.title}</p>
                      {text.body && <p className="text-muted-foreground text-sm mt-0.5">{text.body}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
