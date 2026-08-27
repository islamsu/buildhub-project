import { useRef, useState } from 'react';
import { Paperclip, X, Loader2, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import {
  AI_ATTACHMENT_TYPES,
  MAX_AI_ATTACHMENT_SIZE,
  isAiAttachmentImage,
} from '@shared/aiAttachments';

export type UploadedAttachment = { id: number; name: string; contentType: string; size: number };

/**
 * The attach control on the AI composer.
 *
 * The accepted formats come from @shared/aiAttachments, the same constant the
 * SERVER validates against - so the file picker cannot offer something the
 * upload would then refuse. Client-side checks here are a courtesy that saves a
 * round trip; the server repeats every one of them and does not trust any of
 * this.
 */
export function AIAttachmentControl({
  attachment,
  onAttached,
  onCleared,
  disabled,
}: {
  attachment: UploadedAttachment | null;
  onAttached: (uploaded: UploadedAttachment) => void;
  onCleared: () => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = trpc.ai.uploadAttachment.useMutation({
    onSuccess: uploaded => { setError(null); onAttached(uploaded); },
    onError: problem => setError(problem.message),
  });
  const remove = trpc.ai.deleteAttachment.useMutation();

  const pick = () => { setError(null); inputRef.current?.click(); };

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so choosing the SAME file again still fires a change
    // event - otherwise a failed upload cannot be retried with the same file.
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_AI_ATTACHMENT_SIZE) {
      setError(t('ai.attach.hint'));
      return;
    }

    let base64: string;
    try {
      base64 = await readAsBase64(file);
    } catch {
      setError(t('ai.attach.readError'));
      return;
    }

    upload.mutate({ fileName: file.name, contentType: file.type, base64 });
  };

  const clear = () => {
    if (attachment) remove.mutate({ id: attachment.id });
    setError(null);
    onCleared();
  };

  if (attachment) {
    const Icon = isAiAttachmentImage(attachment.contentType) ? ImageIcon : FileText;
    return (
      <div
        // Wraps on a narrow screen instead of pushing the composer sideways.
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
        data-testid="ai-attachment"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {/* min-w-0 + truncate: a long filename must not stretch the row. */}
        <span className="min-w-0 flex-1 truncate font-medium" title={attachment.name}>{attachment.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {shortType(attachment.contentType)} · {formatSize(attachment.size)}
        </span>
        <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">{t('ai.attach.ready')}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={clear}
          aria-label={t('ai.attach.remove')}
          title={t('ai.attach.remove')}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={AI_ATTACHMENT_TYPES.join(',')}
        onChange={onFileChosen}
        data-testid="ai-attachment-input"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={pick}
        disabled={disabled || upload.isPending}
        className="gap-2"
        data-testid="ai-attachment-button"
      >
        {upload.isPending
          ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          : <Paperclip className="size-4" aria-hidden="true" />}
        {upload.isPending ? t('ai.attach.uploading') : t('ai.attach.button')}
      </Button>
      {error
        ? (
          <span role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </span>
        )
        : <span className="text-xs text-muted-foreground">{t('ai.attach.hint')}</span>}
    </div>
  );
}

/** Just the distinctive half - "PDF", "PNG" - not the full MIME string. */
const shortType = (contentType: string): string =>
  (contentType.split('/')[1] ?? contentType).toUpperCase();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The file's bytes as base64, without the `data:...;base64,` prefix. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      if (comma === -1) { reject(new Error('unreadable')); return; }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
