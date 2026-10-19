import { ValidationError } from '../errors.js';

/**
 * Single source of truth for "which document states may be embedded by the
 * backfill runner".
 *
 * Two policies exist and they are deliberately different:
 *
 *  - `general`  — the programmatic write path used by ingestion and the
 *                 re-embed route. A document is embeddable while it is mid
 *                 pipeline (`embedding`) or already published and being
 *                 refreshed (`ready`).
 *  - `operator` — the future operator/migration backfill entry point. Only
 *                 documents that have been published (`ready`) are eligible, so
 *                 a migration can never race an in-flight ingestion.
 *
 * A document in any other state — including a missing one, one whose status is
 * absent, or one carrying an unrecognised value — is ineligible. The policy is
 * fail-closed by construction: eligibility is an allow-list, never a deny-list,
 * so a newly added document status cannot silently become embeddable.
 */
export const EMBEDDING_ELIGIBILITY_POLICIES = Object.freeze({
  general: Object.freeze(['embedding', 'ready']),
  operator: Object.freeze(['ready'])
});

export const DEFAULT_EMBEDDING_ELIGIBILITY_POLICY = 'general';

export const OPERATOR_BACKFILL_ELIGIBLE_STATUSES = EMBEDDING_ELIGIBILITY_POLICIES.operator;

/**
 * Stable, non-sensitive reason codes returned on an ineligible evaluation (and
 * copied onto the runner's `ineligible` result). Callers can branch on these
 * without parsing prose.
 */
export const EMBEDDING_INELIGIBLE_REASONS = Object.freeze({
  documentMissing: 'document_missing',
  statusIneligible: 'document_status_ineligible'
});

export function isKnownEmbeddingEligibilityPolicy(policy) {
  return Object.prototype.hasOwnProperty.call(EMBEDDING_ELIGIBILITY_POLICIES, policy);
}

export function assertEmbeddingEligibilityPolicy(policy) {
  if (!isKnownEmbeddingEligibilityPolicy(policy)) {
    const known = Object.keys(EMBEDDING_ELIGIBILITY_POLICIES).join(', ');
    throw new ValidationError(`Unknown embedding eligibility policy "${policy}" (expected one of: ${known}).`);
  }

  return policy;
}

export function eligibleDocumentStatuses(policy = DEFAULT_EMBEDDING_ELIGIBILITY_POLICY) {
  assertEmbeddingEligibilityPolicy(policy);
  return EMBEDDING_ELIGIBILITY_POLICIES[policy];
}

/**
 * Decide whether `document` may be embedded under `policy`.
 *
 * Returns `{ eligible, reason, documentStatus, policy }`. `reason` is a stable
 * code from `EMBEDDING_INELIGIBLE_REASONS` when ineligible, otherwise `null`.
 */
export function evaluateEmbeddingEligibility(document, policy = DEFAULT_EMBEDDING_ELIGIBILITY_POLICY) {
  const statuses = eligibleDocumentStatuses(policy);

  if (!document) {
    return {
      eligible: false,
      reason: EMBEDDING_INELIGIBLE_REASONS.documentMissing,
      documentStatus: null,
      policy
    };
  }

  const documentStatus = typeof document.status === 'string' ? document.status : null;

  if (documentStatus === null || !statuses.includes(documentStatus)) {
    return {
      eligible: false,
      reason: EMBEDDING_INELIGIBLE_REASONS.statusIneligible,
      documentStatus,
      policy
    };
  }

  return { eligible: true, reason: null, documentStatus, policy };
}
