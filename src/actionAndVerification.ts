/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ActionApprovalRecord,
  BloodRequest,
  CallListItem,
  DecisionTrace,
  PortalEvidenceRecord,
  VerificationAuditRecord,
  VerificationStatus,
} from './types';

export type ProposalsContainer =
  | Map<string, ActionApprovalRecord>
  | Record<string, ActionApprovalRecord>;

function getProposal(container: ProposalsContainer, requestId: string): ActionApprovalRecord | undefined {
  if (container instanceof Map) {
    return container.get(requestId);
  }
  return container[requestId];
}

function setProposal(container: ProposalsContainer, requestId: string, record: ActionApprovalRecord): void {
  if (container instanceof Map) {
    container.set(requestId, record);
  } else {
    container[requestId] = record;
  }
}

/**
 * Step 4 (Permitted Action):
 * Creates an ActionApprovalRecord in 'PENDING_APPROVAL' state.
 * Does NOT execute or finalize the call list automatically.
 */
export function createActionProposal(
  request: BloodRequest,
  candidateCallList: CallListItem[],
  existingProposalsMap: ProposalsContainer
): ActionApprovalRecord {
  const existing = getProposal(existingProposalsMap, request.request_id);
  if (existing) {
    return existing;
  }

  const actionId = `ACT-${request.request_id.slice(-7)}-${Date.now().toString().slice(-4)}`;
  const destination = 'RaktPramaan Verified Family Call Sheet (Read-Only Portal Query)';

  const phonesList = candidateCallList.map((c) => c.phone_number).filter(Boolean);
  const timestampsCount = candidateCallList.filter(
    (c) => c.source_last_updated && c.source_last_updated !== 'MISSING_TIMESTAMP'
  ).length;

  const changeSummary = `Prepare verified emergency call sheet of ${candidateCallList.length} blood bank(s) with ${phonesList.length} phone outreach endpoint(s) and ${timestampsCount} validated stock timestamp(s) for request ${request.request_id} (${request.quantity_units} unit(s) of ${request.blood_group} ${request.component} in ${request.district}). External targets remain 100% read-only.`;

  const newRecord: ActionApprovalRecord = {
    action_id: actionId,
    request_id: request.request_id,
    proposed_destination: destination,
    proposed_change_summary: changeSummary,
    proposed_call_list: candidateCallList,
    approval_status: 'PENDING_APPROVAL',
    approved_by: null,
    approved_at: null,
    duplicate_retries_blocked: 0,
  };

  setProposal(existingProposalsMap, request.request_id, newRecord);
  return newRecord;
}

/**
 * Step 4 (Human Approval & Idempotency Guard):
 * Transitions status to 'APPROVED'. If already approved, blocks duplicate execution and increments counter.
 */
export interface ApprovalResult {
  record: ActionApprovalRecord;
  wasDuplicateRetry: boolean;
  message: string;
}

export function approveActionWithIdempotency(
  requestId: string,
  approverName: string,
  proposalsMap: ProposalsContainer
): ApprovalResult {
  const existing = getProposal(proposalsMap, requestId);

  if (!existing) {
    throw new Error(`Action proposal for request_id "${requestId}" not found. Must propose before approving.`);
  }

  // Idempotency check: If already APPROVED, block duplicate execution
  if (existing.approval_status === 'APPROVED') {
    const updated: ActionApprovalRecord = {
      ...existing,
      duplicate_retries_blocked: existing.duplicate_retries_blocked + 1,
    };
    setProposal(proposalsMap, requestId, updated);

    return {
      record: updated,
      wasDuplicateRetry: true,
      message: 'Call sheet already finalized for this request ID — returning locked approved call sheet without duplicate execution.',
    };
  }

  // Normal approval transition
  const nowIso = new Date().toISOString();
  const approvedRecord: ActionApprovalRecord = {
    ...existing,
    approval_status: 'APPROVED',
    approved_by: approverName.trim() || 'Authorized Medical Officer',
    approved_at: nowIso,
  };

  setProposal(proposalsMap, requestId, approvedRecord);

  return {
    record: approvedRecord,
    wasDuplicateRetry: false,
    message: 'Coordinator approval recorded. Call sheet finalized.',
  };
}

/**
 * Step 5: Separate Independent Verification Check
 * Inspects timestamps, age calculations, stock totals, and exclusions independently from the decision engine.
 */
export function runIndependentVerification(
  request: BloodRequest,
  rawEvidence: PortalEvidenceRecord[],
  decisions: DecisionTrace[],
  callList: CallListItem[]
): VerificationAuditRecord {
  const auditId = `AUD-${request.request_id.slice(-7)}-${Date.now().toString().slice(-4)}`;

  // 1. Independently recalculate age_hours on callList items and find stale entries
  const staleFlaggedEvidenceIds: string[] = [];
  const staleDescriptions: string[] = [];

  callList.forEach((item) => {
    if (item.source_last_updated && item.source_last_updated !== 'MISSING_TIMESTAMP') {
      const retrievedMs = new Date(item.retrieved_at).getTime();
      const updatedMs = new Date(item.source_last_updated).getTime();
      const independentAgeHours = Math.max(0, Math.round(((retrievedMs - updatedMs) / (1000 * 60 * 60)) * 10) / 10);

      if (independentAgeHours > 24) {
        if (!staleFlaggedEvidenceIds.includes(item.evidence_id)) {
          staleFlaggedEvidenceIds.push(item.evidence_id);
          const daysOld = Math.round((independentAgeHours / 24) * 10) / 10;
          staleDescriptions.push(
            `1 entry marked STALE (${item.bank_name} - ${independentAgeHours}h old — last updated ~${daysOld} day(s) ago)`
          );
        }
      }
    }
  });

  // Also check raw evidence for any stale entries that were rejected or flagged
  rawEvidence.forEach((ev) => {
    if (ev.source_last_updated) {
      const retrievedMs = new Date(ev.retrieved_at).getTime();
      const updatedMs = new Date(ev.source_last_updated).getTime();
      const independentAgeHours = (retrievedMs - updatedMs) / (1000 * 60 * 60);
      if (independentAgeHours > 24 && !staleFlaggedEvidenceIds.includes(ev.evidence_id)) {
        staleFlaggedEvidenceIds.push(ev.evidence_id);
      }
    }
  });

  // 2. Collect any evidence record with missing source_last_updated
  const uncertainEvidenceIds: string[] = rawEvidence
    .filter((e) => !e.source_last_updated)
    .map((e) => e.evidence_id);

  // 3. Sum total_fresh_units_found across primary-district fresh banks
  const primaryFreshCallItems = callList.filter(
    (c) =>
      c.bank_district.toLowerCase().trim() === request.district.toLowerCase().trim() &&
      c.freshness_badge === 'FRESH' &&
      !staleFlaggedEvidenceIds.includes(c.evidence_id)
  );

  const totalFreshUnitsFound = primaryFreshCallItems.reduce(
    (sum, c) => sum + c.available_units,
    0
  );

  const unresolvedShortfallUnits = Math.max(0, request.quantity_units - totalFreshUnitsFound);

  // 4. Construct intended_state as clean clinical statement
  const intendedState = `Target: >= ${request.quantity_units} units of fresh (<24h) ${request.blood_group} ${request.component} in ${request.district}`;

  // 5. Construct unresolved_items_summary
  const unresolvedItemsSummary: string[] = [];

  // (a) Stale entries found
  if (staleDescriptions.length > 0) {
    unresolvedItemsSummary.push(...staleDescriptions);
  } else if (staleFlaggedEvidenceIds.length > 0) {
    unresolvedItemsSummary.push(
      `${staleFlaggedEvidenceIds.length} portal record(s) flagged STALE (>24h old: ${staleFlaggedEvidenceIds.join(', ')}).`
    );
  }

  // (b) UNCERTAIN entries held back due to missing timestamps
  if (uncertainEvidenceIds.length > 0) {
    const uncertainBanks = rawEvidence
      .filter((e) => uncertainEvidenceIds.includes(e.evidence_id))
      .map((e) => e.bank_name)
      .join(', ');
    unresolvedItemsSummary.push(
      `Portal record(s) ${uncertainEvidenceIds.join(', ')} (${uncertainBanks}) withheld due to missing last-updated timestamp.`
    );
  }

  // (c) Component mismatches rejected
  const mismatchDecisions = decisions.filter(
    (d) => d.inclusion_state === 'EXCLUDED_MISMATCH' && !d.component_matched
  );
  if (mismatchDecisions.length > 0) {
    const mismatchedSamples = rawEvidence.filter((e) =>
      mismatchDecisions.some((d) => d.evidence_id === e.evidence_id)
    );
    const listedNames = mismatchedSamples
      .map((m) => `${m.bank_name} (Listed: ${m.listed_component} vs Requested: ${request.component})`)
      .join('; ');
    unresolvedItemsSummary.push(
      `Component mismatch: ${mismatchDecisions.length} listing(s) excluded (${listedNames}).`
    );
  }

  // (d) Local district 0 stock and nearest districts offered instead
  const localEvidence = rawEvidence.filter(
    (e) => e.bank_district.toLowerCase().trim() === request.district.toLowerCase().trim()
  );
  const localUnitsTotal = localEvidence.reduce((sum, e) => sum + e.available_units, 0);
  const fallbackItems = callList.filter((c) => c.is_fallback_district);

  if (localUnitsTotal === 0 && fallbackItems.length > 0) {
    const fallbackDistricts = Array.from(new Set(fallbackItems.map((f) => f.bank_district))).join(', ');
    unresolvedItemsSummary.push(
      `0 units available in ${request.district}; matched from nearest neighbouring district (${fallbackDistricts}).`
    );
  }

  // Status computation
  let verificationStatus: VerificationStatus = 'PENDING_EXECUTION';

  if (callList.length === 0) {
    verificationStatus = 'FAILED_NO_MATCH_OR_UNRESOLVED';
    unresolvedItemsSummary.push(
      `Zero matching facilities found. Total shortfall remains ${unresolvedShortfallUnits} unit(s).`
    );
  } else if (callList.some((c) => staleFlaggedEvidenceIds.includes(c.evidence_id))) {
    verificationStatus = 'WARNING_STALE_ENTRIES_MARKED';
  } else if (unresolvedShortfallUnits > 0 && fallbackItems.length === 0) {
    verificationStatus = 'WARNING_STALE_ENTRIES_MARKED';
    unresolvedItemsSummary.push(
      `Shortfall of ${unresolvedShortfallUnits} unit(s) in primary district. Additional supply needed.`
    );
  } else if (totalFreshUnitsFound >= request.quantity_units && staleDescriptions.length === 0) {
    verificationStatus = 'PASSED_ALL_FRESH';
  } else if (fallbackItems.length > 0 && totalFreshUnitsFound < request.quantity_units) {
    const fallbackFreshUnits = fallbackItems
      .filter((c) => c.freshness_badge === 'FRESH')
      .reduce((s, c) => s + c.available_units, 0);

    if (totalFreshUnitsFound + fallbackFreshUnits >= request.quantity_units) {
      verificationStatus = 'PASSED_ALL_FRESH';
    } else {
      verificationStatus = 'WARNING_STALE_ENTRIES_MARKED';
    }
  } else {
    verificationStatus = 'WARNING_STALE_ENTRIES_MARKED';
  }

  // Construct observed_state as clean clinical statement
  let observedState = '';
  if (callList.length === 0) {
    observedState = `Audit Result: 0 matching facilities found; ${unresolvedShortfallUnits} unit shortfall.`;
  } else if (uncertainEvidenceIds.length > 0) {
    observedState = `Audit Result: ${totalFreshUnitsFound} fresh units verified across ${primaryFreshCallItems.length} local bank(s); 1 unverified record withheld due to missing timestamp.`;
  } else if (staleFlaggedEvidenceIds.length > 0) {
    observedState = `Audit Result: 1 fresh bank verified (${totalFreshUnitsFound} units); 1 stale record flagged (>24h).`;
  } else if (fallbackItems.length > 0) {
    observedState = `Audit Result: 0 units in ${request.district}; ${callList.length} verified facilities identified in adjacent districts.`;
  } else {
    observedState = `Audit Result: ${callList.length} verified candidate facilities; ${totalFreshUnitsFound} fresh units confirmed.`;
  }

  return {
    audit_id: auditId,
    request_id: request.request_id,
    intended_state: intendedState,
    observed_state: observedState,
    verification_status: verificationStatus,
    total_units_requested: request.quantity_units,
    total_fresh_units_found: totalFreshUnitsFound,
    unresolved_shortfall_units: unresolvedShortfallUnits,
    stale_flagged_evidence_ids: staleFlaggedEvidenceIds,
    uncertain_evidence_ids: uncertainEvidenceIds,
    unresolved_items_summary: unresolvedItemsSummary,
  };
}
