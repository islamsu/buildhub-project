/**
 * ── THE AFFORDANCE THAT HANDS OVER CONTEXT ──────────────────────────────
 *
 * There were a dozen "Ask AI" buttons in the product and every one of them went
 * to a bare `/ai`. The assistant opened knowing nothing about the request,
 * quotation, provider or project the person had been looking at a second
 * earlier, and offered them the same six fixed prompts it offered everybody.
 *
 * This carries the SUBJECT across. `/ai?subject=request&id=42` tells the
 * assistant what was selected; the server re-derives what this account may see
 * and builds its suggestions from the object, the session role, the workflow
 * stage and the viewer's permitted projection of it.
 *
 * ── IT IS A SELECTOR, NOT A CAPABILITY ──────────────────────────────────
 *
 * The id in the URL is a number somebody can type. `ai.suggestions` resolves it
 * against what the caller may already see and falls back to the general list
 * when it may not, so a guessed id reveals nothing about whether it exists.
 * That is the same discipline `?project=` already used, applied to every kind
 * of object.
 *
 * ── AND IT ASKS NOTHING ─────────────────────────────────────────────────
 *
 * Following this link SELECTS a subject. It does not compose a question, does
 * not append a message, and does not submit anything. The assistant offers
 * suggestions and waits - FINISHING_AND_AI_CONTEXT.md §2.
 */
import { Link } from 'wouter';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SuggestionSubject } from '@shared/aiSuggestions';

type Props = {
  subject: SuggestionSubject;
  /** The record the reader selected. Omitted for a category or a service. */
  id?: number | null;
  /** A category or service name the click carried. Display data only. */
  subtype?: string | null;
  lang: 'en' | 'ar';
  /** Defaults to a quiet outline button beside the thing it is about. */
  variant?: 'outline' | 'ghost' | 'secondary';
  size?: 'sm' | 'default';
  className?: string;
  /** Override the label where the surrounding copy makes a better one. */
  label?: string;
};

/** What the button says, by what was selected. */
const LABELS: Readonly<Record<SuggestionSubject, { en: string; ar: string }>> = {
  request:   { en: 'Ask AI about this request',   ar: 'اسأل المساعد عن هذا الطلب' },
  quotation: { en: 'Ask AI about this quotation', ar: 'اسأل المساعد عن هذا العرض' },
  provider:  { en: 'Ask AI about this provider',  ar: 'اسأل المساعد عن هذا المورّد' },
  project:   { en: 'Ask AI about this project',   ar: 'اسأل المساعد عن هذا المشروع' },
  category:  { en: 'Ask AI about this category',  ar: 'اسأل المساعد عن هذا التصنيف' },
  service:   { en: 'Ask AI about this service',   ar: 'اسأل المساعد عن هذه الخدمة' },
  boq_item:  { en: 'Ask AI about this line',      ar: 'اسأل المساعد عن هذا البند' },
  general:   { en: 'Ask the assistant',           ar: 'اسأل المساعد' },
};

export function askAiHref(subject: SuggestionSubject, id?: number | null, subtype?: string | null): string {
  const params = new URLSearchParams({ subject });
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) params.set('id', String(id));
  if (subtype) params.set('subtype', subtype);
  return `/ai?${params.toString()}`;
}

export default function AskAiAbout({
  subject, id, subtype, lang, variant = 'outline', size = 'sm', className, label,
}: Props) {
  return (
    <Button
      asChild
      variant={variant}
      size={size}
      className={className}
      data-testid={`ask-ai-${subject}`}
    >
      <Link href={askAiHref(subject, id, subtype)} className="gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        {label ?? LABELS[subject][lang]}
      </Link>
    </Button>
  );
}
