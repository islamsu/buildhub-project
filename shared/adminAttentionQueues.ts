/**
 * The attention-queue vocabulary, in its own module so `shared/` and
 * `server/` can both name it without a cycle: `shared/adminAttention.ts`
 * holds the bilingual wording and `server/adminAttention.ts` holds the
 * counting, and both need this list.
 */
export const ATTENTION_QUEUES = [
  'enquiries', 'registrations', 'disputes', 'support', 'reviews', 'nameChanges',
  'productQuestions',
] as const;
export type AttentionQueue = (typeof ATTENTION_QUEUES)[number];
