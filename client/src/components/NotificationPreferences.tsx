import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { LoadFailed, loadFailedCopy } from '@/components/LoadFailed';
import {
  isMandatoryCategory,
  notificationCategoryHelp,
  notificationCategoryLabel,
  type NotificationCategory,
} from '@shared/notificationPreferences';

/**
 * WHICH NOTIFICATIONS BUILDHUB SENDS YOU.
 *
 * ONE CHANNEL, SAID OUT LOUD. BuildHub delivers notifications in the app and
 * nowhere else: there is no configured mail provider and no SMS sender, and no
 * notification is routed to either. So this screen offers no Email column and
 * no SMS column - it says plainly that they are not available instead. A row
 * of switches wired to nothing is worse than an absent feature, because the
 * user believes they have turned something on.
 *
 * MANDATORY CATEGORIES ARE SHOWN, LOCKED, AND EXPLAINED. Hiding them would be
 * easier and would leave a user wondering why a registration decision arrived
 * after they "turned notifications off". Each locked row carries the reason it
 * is locked - the consequence of not receiving it - so the lock reads as a
 * decision rather than a fault.
 *
 * AND THE LOCK IS NOT THE CONTROL. `setNotificationPreference` refuses a
 * mandatory category on the server. This switch being disabled is a courtesy
 * to the person reading the page, not what stops the request.
 */
export default function NotificationPreferences() {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const utils = trpc.useUtils();
  const prefs = trpc.notifications.preferences.useQuery(undefined, { retry: false });
  const [failed, setFailed] = useState<NotificationCategory | null>(null);

  const save = trpc.notifications.setPreference.useMutation({
    onMutate: ({ category }) => { setFailed(null); return { category }; },
    onSuccess: () => { void utils.notifications.preferences.invalidate(); },
    // THE SWITCH GOES BACK. A control that stays where the user left it while
    // the server refused the change tells them the opposite of what happened.
    onError: (_error, variables) => {
      setFailed(variables.category as NotificationCategory);
      void utils.notifications.preferences.invalidate();
    },
  });

  if (prefs.isError) {
    return (
      <Card data-testid="notification-preferences">
        <CardContent className="pt-6">
          <LoadFailed {...loadFailedCopy(ar)} onRetry={() => void prefs.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (!prefs.data) {
    return (
      <Card data-testid="notification-preferences-loading">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  const optional = prefs.data.filter(row => !row.mandatory);
  const mandatory = prefs.data.filter(row => row.mandatory);

  const Row = ({ category, enabled, locked }: { category: NotificationCategory; enabled: boolean; locked: boolean }) => (
    <div
      className="flex items-start justify-between gap-4 border-b py-4 last:border-b-0"
      data-testid={`notif-pref-${category}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t(notificationCategoryLabel(category))}</span>
          {locked && (
            <Badge variant="secondary" className="gap-1" data-testid={`notif-pref-locked-${category}`}>
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t('notifPrefs.required')}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t(notificationCategoryHelp(category))}</p>
        {failed === category && (
          <p className="mt-1 text-sm text-destructive" data-testid={`notif-pref-failed-${category}`}>
            {t('notifPrefs.saveFailed')}
          </p>
        )}
      </div>
      <Switch
        checked={enabled}
        disabled={locked || save.isPending}
        onCheckedChange={next => save.mutate({ category, enabled: next })}
        aria-label={t(notificationCategoryLabel(category))}
        data-testid={`notif-pref-switch-${category}`}
      />
    </div>
  );

  return (
    <Card data-testid="notification-preferences">
      <CardContent className="space-y-6 pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{t('notifPrefs.description')}</p>
          <p className="mt-2 text-sm text-muted-foreground" data-testid="notif-prefs-channel-note">
            {t('notifPrefs.channelNote')}
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-semibold">{t('notifPrefs.optionalHeading')}</h3>
          <div>
            {optional.map(row => (
              <Row key={row.category} category={row.category} enabled={row.enabled} locked={false} />
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-semibold">{t('notifPrefs.mandatoryHeading')}</h3>
          <p className="mb-1 text-sm text-muted-foreground">{t('notifPrefs.requiredNote')}</p>
          <div>
            {mandatory.map(row => (
              // `locked` is read from the shared vocabulary rather than from
              // the row, so the screen and the server cannot disagree about
              // which categories are mandatory.
              <Row key={row.category} category={row.category} enabled={row.enabled} locked={isMandatoryCategory(row.category)} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
