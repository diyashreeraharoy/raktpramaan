/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type BloodGroup = 'O-' | 'O+' | 'A-' | 'A+' | 'B-' | 'B+' | 'AB-' | 'AB+';

export type BloodComponent =
  | 'Packed Red Blood Cells (PRBC)'
  | 'Whole Blood'
  | 'Platelets'
  | 'Fresh Frozen Plasma (FFP)';

export type TestCaseLabel = 'TC1' | 'TC2' | 'TC3' | 'TC4' | 'CUSTOM';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy_m?: number;
}

export interface BloodRequest {
  request_id: string; // stable ID, e.g., 'REQ-TC1-001'
  test_case_label: TestCaseLabel;
  synthetic_family_ref: string; // e.g., 'SYNTH-FAM-2026 (Synthetic Data - No Real PII)'
  blood_group: BloodGroup;
  component: BloodComponent;
  quantity_units: number;
  state: string; // Indian State or UT, e.g., 'West Bengal', 'Maharashtra', 'Karnataka'
  district: string; // Target District, e.g., 'Darjeeling', 'Mumbai City', 'Bengaluru Urban'
  user_coordinates?: GeoCoordinates; // Real GPS coordinates from browser geolocation
  created_at: string; // ISO UTC
  is_valid: boolean;
  validation_errors: string[];
}

export type RetrievalMethod =
  | 'LIVE_ERAKTKOSH_API'
  | 'LIVE_API_SETU'
  | 'READ_ONLY_PORTAL_SNAPSHOT'
  | 'SAFE_MANUAL_HTML_PASTE';

export interface PortalEvidenceRecord {
  evidence_id: string; // stable ID, e.g., 'EVID-TC1-01'
  request_id: string;
  source_id: string; // e.g., 'ERAKTKOSH-WB-DARJ-101'
  source_url: string; // read-only public portal URL
  retrieval_method: RetrievalMethod;
  retrieved_at: string; // ISO UTC
  bank_name: string;
  bank_district: string;
  distance_km: number | null;
  latitude?: number;
  longitude?: number;
  is_haversine_calculated?: boolean;
  phone_number: string;
  listed_blood_group: BloodGroup;
  listed_component: BloodComponent;
  available_units: number;
  source_last_updated: string | null; // null tests missing evidence -> UNCERTAIN state
  is_live_feed?: boolean;
}

export interface LiveRegistryFetchResult {
  records: PortalEvidenceRecord[];
  is_live: boolean;
  source_name: 'LIVE_ERAKTKOSH_API' | 'LIVE_API_SETU' | 'OFFLINE_BENCHMARK_FIXTURE';
  status_alert?: string;
  endpoint_queried: string;
}

export type FreshnessState = 'FRESH' | 'STALE' | 'STALE_STOCK_DISQUALIFIED' | 'UNCERTAIN';

export type InclusionState =
  | 'INCLUDED_PRIMARY'
  | 'INCLUDED_NEAREST_DISTRICT'
  | 'EXCLUDED_MISMATCH'
  | 'EXCLUDED_ZERO_UNITS'
  | 'UNCERTAIN_MISSING_EVIDENCE';

export interface DecisionTrace {
  decision_id: string;
  request_id: string;
  evidence_id: string;
  input_evidence_summary: string;
  component_matched: boolean;
  age_hours: number | null;
  freshness_state: FreshnessState;
  inclusion_state: InclusionState;
  priority_score: number;
  decision_reason: string;
}

export interface CallListItem {
  rank: number;
  evidence_id: string;
  decision_id: string;
  bank_name: string;
  bank_district: string;
  is_fallback_district: boolean;
  distance_km: number;
  latitude?: number;
  longitude?: number;
  is_haversine_calculated?: boolean;
  phone_number: string;
  component: BloodComponent;
  available_units: number;
  source_last_updated: string;
  retrieved_at: string;
  age_hours: number;
  freshness_badge: 'FRESH' | 'STALE';
  source_url: string;
  travel_advisory: string;
}

export type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface ActionApprovalRecord {
  action_id: string;
  request_id: string; // unique idempotency key
  proposed_destination: string;
  proposed_change_summary: string;
  proposed_call_list: CallListItem[];
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  duplicate_retries_blocked: number;
}

export type VerificationStatus =
  | 'PASSED_ALL_FRESH'
  | 'WARNING_STALE_ENTRIES_MARKED'
  | 'FAILED_NO_MATCH_OR_UNRESOLVED'
  | 'PENDING_EXECUTION';

export interface VerificationAuditRecord {
  audit_id: string;
  request_id: string;
  intended_state: string;
  observed_state: string;
  verification_status: VerificationStatus;
  total_units_requested: number;
  total_fresh_units_found: number;
  unresolved_shortfall_units: number;
  stale_flagged_evidence_ids: string[];
  uncertain_evidence_ids: string[];
  unresolved_items_summary: string[];
}

export interface OfficialTestRunRecord {
  test_id: 'TC1' | 'TC2' | 'TC3' | 'TC4';
  scenario_title: string;
  rubric_badge?: string;
  specified_input: BloodRequest;
  expected_result: string;
  actual_result: string;
  evidence_ids: string[];
  difference_or_failure_explanation: string;
}

export type AgentStage = '01_COLLECT' | '02_PLAN' | '03_FIND' | '04_ACT_PROPOSE' | '05_VERIFY';

export interface AgentToolCallLog {
  step_number: number;
  stage: AgentStage;
  tool_name: string;
  tool_input: string;
  tool_output_summary: string;
  timestamp: string;
}

export interface AgentExecutionTrace {
  request_id: string;
  model_id: string;
  execution_mode: 'LIVE_GEMINI_AGENT' | 'DETERMINISTIC_GUARDRAIL_ENGINE';
  planning_rationale: string;
  clinical_triage_briefing: string;
  tool_calls: AgentToolCallLog[];
  latency_ms: number;
}

