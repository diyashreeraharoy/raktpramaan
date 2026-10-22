/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BloodRequest,
  CallListItem,
  DecisionTrace,
  FreshnessState,
  InclusionState,
  PortalEvidenceRecord,
} from './types';
import { DISTRICT_ADJACENCY, getAdjacentDistricts, haversineDistanceKm } from './portalData';
import { runIndependentVerification } from './actionAndVerification';

/**
 * Canonical formatting helper for record age to eliminate contradictory text.
 * Accurately matches exact hours to correct day counts:
 * e.g., 24h = 1 Day Ago, 48h = 2 Days Ago, 72h+ = 3+ Days Stale.
 */
export function formatAgeLabel(hours: number | null): string {
  if (hours === null || hours === undefined) return 'Missing Timestamp';
  if (hours <= 0) return 'Just now';
  if (hours < 1) return '<1h ago';
  if (hours === 1) return '1h ago';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  if (days === 1) {
    return rem > 0 ? `1 Day ${rem}h Ago (24h+ Stale)` : '24h Ago (1 Day Ago)';
  }
  return rem > 0 ? `${days} Days ${rem}h Ago (${Math.round(hours)}h Stale)` : `${days} Days Ago (${Math.round(hours)}h Stale)`;
}

/**
 * Step 3: Run Deterministic Decision Rules on Evidence Records
 */
export function evaluateEvidenceRules(
  request: BloodRequest,
  evidenceList: PortalEvidenceRecord[]
): DecisionTrace[] {
  // Pre-calculate whether primary district has any verified fresh matching stock
  const hasFreshPrimaryStock = evidenceList.some((ev) => {
    const isPrimary =
      ev.bank_district.toLowerCase().trim() === request.district.toLowerCase().trim();
    const groupMatch =
      ev.listed_blood_group.toUpperCase().trim() === request.blood_group.toUpperCase().trim();
    const compMatch =
      ev.listed_component.toLowerCase().trim() === request.component.toLowerCase().trim();
    const hasUnits = ev.available_units > 0;
    let isFresh = false;
    if (ev.source_last_updated) {
      const retrievedMs = new Date(ev.retrieved_at).getTime();
      const updatedMs = new Date(ev.source_last_updated).getTime();
      const diffHours = (retrievedMs - updatedMs) / (1000 * 60 * 60);
      isFresh = diffHours <= 24;
    }
    return isPrimary && groupMatch && compMatch && hasUnits && isFresh;
  });

  return evidenceList.map((evidence, idx) => {
    const decisionId = `DEC-${request.request_id.slice(-7)}-${(idx + 1).toString().padStart(2, '0')}`;
    
    // Check component match
    const componentMatched =
      evidence.listed_component.toLowerCase().trim() ===
      request.component.toLowerCase().trim();

    // Check blood group match
    const bloodGroupMatched =
      evidence.listed_blood_group.toUpperCase().trim() ===
      request.blood_group.toUpperCase().trim();

    // Calculate age & freshness
    let ageHours: number | null = null;
    let freshnessState: FreshnessState = 'UNCERTAIN';

    if (evidence.source_last_updated) {
      const retrievedMs = new Date(evidence.retrieved_at).getTime();
      const updatedMs = new Date(evidence.source_last_updated).getTime();
      const diffHours = (retrievedMs - updatedMs) / (1000 * 60 * 60);
      ageHours = Math.max(0, Math.round(diffHours * 10) / 10);

      if (ageHours <= 24) {
        freshnessState = 'FRESH';
      } else {
        freshnessState = 'STALE';
      }
    } else {
      // Missing timestamp rule: immediately mark UNCERTAIN
      freshnessState = 'UNCERTAIN';
    }

    // Determine inclusion state & priority
    let inclusionState: InclusionState = 'EXCLUDED_MISMATCH';
    let decisionReason = '';
    let priorityScore = 0;

    const isPrimaryDistrict =
      evidence.bank_district.toLowerCase().trim() === request.district.toLowerCase().trim();

    // Calculate effective distance: if user_coordinates are provided and evidence has coordinates, compute real-time Haversine distance
    let effectiveDist = evidence.distance_km;
    let isHaversine = false;
    if (
      request.user_coordinates &&
      typeof request.user_coordinates.latitude === 'number' &&
      typeof request.user_coordinates.longitude === 'number' &&
      typeof evidence.latitude === 'number' &&
      typeof evidence.longitude === 'number'
    ) {
      effectiveDist = haversineDistanceKm(
        request.user_coordinates.latitude,
        request.user_coordinates.longitude,
        evidence.latitude,
        evidence.longitude
      );
      isHaversine = true;
    }

    if (!bloodGroupMatched || !componentMatched) {
      inclusionState = 'EXCLUDED_MISMATCH';
      decisionReason = `Excluded: Portal lists ${evidence.listed_component} (${evidence.listed_blood_group}), which does not match requested ${request.component}.`;
      priorityScore = 0;
    } else if (evidence.available_units <= 0) {
      inclusionState = 'EXCLUDED_ZERO_UNITS';
      decisionReason = `Excluded: ${evidence.bank_name} currently reports 0 available units.`;
      priorityScore = 5;
    } else if (freshnessState === 'UNCERTAIN') {
      inclusionState = 'UNCERTAIN_MISSING_EVIDENCE';
      decisionReason = 'Withheld for safety: Portal record does not include a last-updated stock timestamp.';
      priorityScore = 15;
    } else if (isPrimaryDistrict) {
      inclusionState = 'INCLUDED_PRIMARY';
      const distancePenalty = (effectiveDist ?? 10) * 2;
      const unitsBonus = Math.min(evidence.available_units, 10) * 5;

      if (freshnessState === 'FRESH') {
        // Tier 1: Primary district FRESH stock (Base 5000 guarantees outranking any stale stock)
        priorityScore = 5000 + Math.max(0, 100 - distancePenalty) + unitsBonus;
        decisionReason = `Qualified: Exact match in local district (${evidence.bank_district}) with verified stock updated ${ageHours}h ago (${evidence.available_units} units)${isHaversine ? ` [Live GPS Haversine: ${effectiveDist}km]` : ''}.`;
      } else {
        // Tier 3: Primary district STALE stock (>24h old)
        priorityScore = 1000 + Math.max(0, 100 - distancePenalty) + unitsBonus;
        decisionReason = `Caution: Listed in local district, but portal stock was updated ${ageHours}h ago (${formatAgeLabel(ageHours)}). Direct verification call required.${isHaversine ? ` [Live GPS Haversine: ${effectiveDist}km]` : ''}`;
      }
    } else {
      // Inter-district check: Only include fallback if primary district has zero fresh matching stock
      if (hasFreshPrimaryStock) {
        inclusionState = 'EXCLUDED_MISMATCH';
        decisionReason = `Excluded: Primary district (${request.district}) has verified fresh stock available. Neighbouring facility (${evidence.bank_district}) held in reserve.`;
        priorityScore = 0;
      } else {
        inclusionState = 'INCLUDED_NEAREST_DISTRICT';
        const distancePenalty = (effectiveDist ?? 50) * 0.5;
        const unitsBonus = Math.min(evidence.available_units, 10) * 5;

        if (freshnessState === 'FRESH') {
          // Tier 2: Nearest district FRESH fallback (Base 3000)
          priorityScore = 3000 + Math.max(0, 100 - distancePenalty) + unitsBonus;
          decisionReason = `0 units available in ${request.district}; matched from nearest neighbouring district (${evidence.bank_district}, ~${effectiveDist}km)${isHaversine ? ` [Live GPS Haversine: ${effectiveDist}km]` : ''}.`;
        } else {
          // Tier 4: Nearest district STALE fallback (Base 500)
          priorityScore = 500 + Math.max(0, 100 - distancePenalty) + unitsBonus;
          decisionReason = `Caution: Stock in neighbouring district (${evidence.bank_district}), but portal stock was updated ${ageHours}h ago (${formatAgeLabel(ageHours)}).${isHaversine ? ` [Live GPS Haversine: ${effectiveDist}km]` : ''}`;
        }
      }
    }

    return {
      decision_id: decisionId,
      request_id: request.request_id,
      evidence_id: evidence.evidence_id,
      input_evidence_summary: `${evidence.bank_name} (${evidence.bank_district}) | ${evidence.listed_blood_group} ${evidence.listed_component} | Units: ${evidence.available_units} | Dist: ${effectiveDist ?? 'N/A'}km${isHaversine ? ' (Live GPS)' : ''}`,
      component_matched: componentMatched && bloodGroupMatched,
      age_hours: ageHours,
      freshness_state: freshnessState,
      inclusion_state: inclusionState,
      priority_score: Math.max(0, Math.round(priorityScore)),
      decision_reason: decisionReason,
    };
  });
}

/**
 * Step 4: Construct Ranked Call List from Approved Inclusions
 */
export function buildCallList(
  request: BloodRequest,
  evidenceList: PortalEvidenceRecord[],
  traces: DecisionTrace[]
): CallListItem[] {
  const eligibleTraces = traces.filter(
    (t) =>
      t.inclusion_state === 'INCLUDED_PRIMARY' ||
      t.inclusion_state === 'INCLUDED_NEAREST_DISTRICT'
  );

  // Sort by priority score descending
  const sortedTraces = [...eligibleTraces].sort((a, b) => b.priority_score - a.priority_score);

  return sortedTraces.map((trace, index) => {
    const evidence = evidenceList.find((e) => e.evidence_id === trace.evidence_id)!;
    const isFallback = trace.inclusion_state === 'INCLUDED_NEAREST_DISTRICT';

    let effectiveDistance = evidence.distance_km ?? 0;
    let isHaversine = false;
    if (
      request.user_coordinates &&
      typeof request.user_coordinates.latitude === 'number' &&
      typeof request.user_coordinates.longitude === 'number' &&
      typeof evidence.latitude === 'number' &&
      typeof evidence.longitude === 'number'
    ) {
      effectiveDistance = haversineDistanceKm(
        request.user_coordinates.latitude,
        request.user_coordinates.longitude,
        evidence.latitude,
        evidence.longitude
      );
      isHaversine = true;
    }

    let travelAdvisory = isHaversine
      ? `Real-time GPS Haversine direct distance: ${effectiveDistance} km.`
      : 'Standard local transit within district.';

    if (isFallback) {
      const neighbors = getAdjacentDistricts(request.state, request.district);
      const neighborInfo = neighbors.find(
        (n) => n.district.toLowerCase() === evidence.bank_district.toLowerCase()
      );
      travelAdvisory = neighborInfo
        ? `${neighborInfo.distanceOffsetKm} km transit via ${neighborInfo.terrainAdvisory}${isHaversine ? ` (GPS direct: ${effectiveDistance} km)` : ''}`
        : `Inter-district transit to ${evidence.bank_district} (~${effectiveDistance} km). Verify cold-chain transport container.`;
    }

    return {
      rank: index + 1,
      evidence_id: evidence.evidence_id,
      decision_id: trace.decision_id,
      bank_name: evidence.bank_name,
      bank_district: evidence.bank_district,
      is_fallback_district: isFallback,
      distance_km: effectiveDistance,
      latitude: evidence.latitude,
      longitude: evidence.longitude,
      is_haversine_calculated: isHaversine,
      phone_number: evidence.phone_number,
      component: evidence.listed_component,
      available_units: evidence.available_units,
      source_last_updated: evidence.source_last_updated ?? 'MISSING_TIMESTAMP',
      retrieved_at: evidence.retrieved_at,
      age_hours: trace.age_hours ?? 0,
      freshness_badge: trace.freshness_state === 'FRESH' ? 'FRESH' : 'STALE',
      source_url: evidence.source_url,
      travel_advisory: travelAdvisory,
    };
  });
}

/**
 * Step 5: Perform Independent Verification Audit
 */
export const runVerificationAudit = runIndependentVerification;
