# raktpramaan
RAKTPRAMAAN
Verified Emergency Blood Dispatch and Availability Verification Agent
Zero False Hope: A neuro-symbolic agent architecture combining Gemini structured
reasoning with deterministic public health guardrails to eliminate phantom blood
listings and outdated inventory during clinical emergencies.

1.CLINICAL CONTEXT
In acute healthcare emergencies, finding blood is a race against the clock.
However, public blood-bank registries and search platforms frequently exacerbate
crises rather than resolving them due to four critical systemic flaws:

1. THE PHANTOM INVENTORY PROBLEM:
   Registries frequently display static inventory counts without accounting for
   temporal decay. Families and ambulances travel to facilities only to discover
   that listed units were depleted days earlier.
2. CLINICAL COMPONENT MISMATCH:
   Standard search portals treat blood generically, failing to enforce hard
   barriers between Whole Blood, Packed Red Blood Cells (PRBC), Platelets, and
   Fresh Frozen Plasma (FFP).
3. UNCOORDINATED PANIC OUTREACH:
   Exposing unverified facility phone numbers directly to distressed relatives
   overwhelms hospital switchboards and causes unvetted, conflicting dispatches.
4. LARGE LANGUAGE MODEL HALLUCINATION RISKS:
   Standard generative AI models hallucinate stock levels, contact details, and
   addresses when queried in unstructured settings.
   
RaktPramaan resolves these failures through a neuro-symbolic triage agent that
pairs structured reasoning via the Google GenAI SDK with immutable mathematical
and clinical safety guardrails.

2. TECHNICAL ARCHITECTURE AND AGENT PIPELINE
RaktPramaan does not allow an LLM to guess or extrapolate inventory data.
Instead, it runs an agentic pipeline where deterministic rules gate all outputs.
AGENT EXECUTION PIPELINE:
  [01 COLLECT: Clinical Intake]
  Validates ABO/Rh blood group, component type, units required, and coordinates.

  [02 PLAN: Spatial and Proximity Routing]
  Computes distance matrices via Haversine great-circle formula and sets boundary
  corridors.
  
  [03 FIND: Registry Evidence Ingestion]
  Executes read-only ingestion against standardized portal schemas (e-RaktKosh
  compatible structures).
 
  [04 VERIFY AND RANK: Gemini Structured Reasoning + Deterministic Engine]
  Applies Gemini reasoning bounded by deterministic guardrails:
    - Temporal decay verification: Strict <= 24.0h threshold.
    - Component compatibility isolation: Absolute zero substitution rule.
    - Proximity triage and priority scoring.

  [05 ACT: Clinical Coordinator Approval Gate]
  Applies cryptographic telephone masking and requires authorized coordinator
  sign-off before revealing operational dispatch records.
  
DETERMINISTIC SAFETY GUARDRAILS:

* 24-HOUR FRESHNESS CUTOFF:
  Any portal entry older than 24.0 hours from the record timestamp is marked
  STALE_STOCK_DISQUALIFIED. It is demoted below all verified banks and flagged
  with a mandatory telephone verification requirement.

* COMPONENT ISOLATION GATE:
  Strict biological type enforcement. Packed Red Blood Cells (PRBC) cannot be
  substituted with Whole Blood, nor can Platelet requests be fulfilled by plasma.

* AUTONOMOUS INTER-DISTRICT PROXIMITY EXPANSION:
  When a target district contains zero units, the agent automatically evaluates
  adjacent transit corridors using Haversine geodesic calculations to locate the
  nearest regional hub.
  
* HUMAN COORDINATOR APPROVAL GATE:
  Hospital telephone contacts remain cryptographically masked until an authorized
  clinical coordinator reviews and signs off on the dispatch ticket.


3. BENCHMARK TEST HARNESS (TC1 TO TC4)
RaktPramaan incorporates four deterministic verification benchmarks directly
accessible through the System Telemetry and Benchmark Harness:

TC1: HAPPY PATH (VERIFIED FRESH STOCK)
- Location: Darjeeling
- Request: O- Negative, Packed Red Blood Cells (PRBC), 2 Units
- Evidence: Stock updated 2.5 hours ago.
- Guardrail Outcome: Fully qualified, verified fresh stock, ranked as primary
  dispatch facility.

TC2: STALE INVENTORY REJECTION
- Location: Siliguri
- Request: A+ Positive, Whole Blood
- Evidence: Stock updated 72.0 hours ago (3 days stale).
- Guardrail Outcome: Hard rejection under the 24-hour freshness rule. Facility is
  demoted and marked with a mandatory telephone verification warning.

TC3: COMPONENT MISMATCH FILTER
- Location: Darjeeling
- Request: O- Negative, Platelets
- Evidence: Facility lists available Whole Blood only.
- Guardrail Outcome: Cross-component filter blocks invalid substitution.

TC4: ZERO LOCAL STOCK (PROXIMITY TRIAGE)
- Location: Kalimpong
- Request: B- Negative, PRBC
- Evidence: Target district inventory equals zero.
- Guardrail Outcome: Agent executes autonomous spatial expansion to the nearest
  regional inventory hub.

4. TECHNICAL STACK

- Core Agent Engine: Google GenAI SDK (@google/genai, gemini-2.5-flash)
- Deterministic Guardrails: TypeScript mathematical modules (Geodesic Haversine
  routing, temporal decay algorithms)
- User Interface: React 19, TypeScript, Vite, Tailwind CSS
- Data Resilience: Resilient deterministic fallback engine providing zero-crash
  execution during offline or rate-limited scenarios.

5. LOCAL INSTALLATION AND EXECUTION GUIDE

Prerequisites:
- Node.js (version 18.0.0 or higher)
- npm (version 9.0.0 or higher)

Step 1: Clone the repository
  git clone https://github.com/<your-username>/raktpramaan.git
  cd raktpramaan
  
Step 2: Install dependencies
  npm install
  
Step 3: Launch the application
  npm run dev
  
  The development server will initialize at: http://localhost:3000

6. EVALUATOR AUDIT WALKTHROUGH

1. PRIMARY CLINICAL INTERFACE:
   The default interface is clean and clinical, designed for acute triage without
   confusing technical logs or unvetted data. Select blood parameters, choose
   State and District, or click "Detect My Current Location".

2. EVALUATOR DRAWER:
   Click the gear icon in the header or the "System Telemetry and Benchmark
   Harness" link in the footer to access the testing drawer.

3. SCENARIO EXECUTION:
   Select any scenario (such as TC2) to inspect how the agent automatically
   evaluates timestamps, penalizes stale inventory, and enforces safety rules.

4. COORDINATOR SIGN-OFF:
   Observe the Human Coordinator Approval Gate, demonstrating that facility
   numbers remain masked until authorized, preventing disorganized emergency
   outreach.

================================================================================
