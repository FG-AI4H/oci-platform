/**
 * Certification quiz bank (#117, ADR-0003 Phase 1).
 *
 * Hardcoded for v1 so the deploy doesn't require a separate content
 * service. Domain-expert review on the *content* is queued — Sage
 * Bionetworks (Synapse) has indicated they may share their quiz under
 * partner-of-partners attribution; if that lands, this file gets
 * replaced wholesale and the slug bumps to `data_ethics_v2`.
 *
 * Topics per the issue: data ethics, re-identification risk, OCI DUA
 * terms, IRB basics. Pass mark is 80% (12 of 15 correct) — high enough
 * that a careless click-through fails, low enough that a researcher
 * who genuinely understands the material clears on the first attempt.
 *
 * Question shape:
 *   {
 *     id: stable identifier (do NOT renumber when reordering),
 *     prompt: question text,
 *     choices: 4 strings,
 *     correctIndex: 0-based,
 *     explanation: shown after grading on the result page, not before
 *                  submission (so re-attempts can't shortcut by
 *                  reading the answers).
 *   }
 *
 * Order in the array is the canonical question order. Re-attempts
 * see the same questions in the same order — we don't shuffle, since
 * the pool is small and shuffling provides no real grinding defence
 * (the user has the answers from the first attempt regardless).
 */

export interface QuizQuestion {
  id: string;
  prompt: string;
  choices: readonly [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  topic: 'ethics' | 'reidentification' | 'dua' | 'irb';
  explanation: string;
}

export interface QuizDefinition {
  certificationType: string;
  /** Display name shown in the UI header. */
  title: string;
  /** Pass-mark as a percentage (0–100). */
  passMarkPercent: number;
  /** Validity window after a pass, in days. */
  validityDays: number;
  questions: readonly QuizQuestion[];
}

const QUESTIONS: readonly QuizQuestion[] = Object.freeze([
  {
    id: 'q1-data-min',
    prompt:
      'A researcher requesting access to a clinical-imaging dataset asks for the full DICOM headers including referring-physician and accession-number fields. The minimum-necessary principle in research ethics says to:',
    choices: [
      'Provide whatever fields the researcher asks for — they signed a DUA.',
      'Provide only the fields the analytic question requires; refuse the rest.',
      'Always provide everything in PUBLIC datasets, never in RESTRICTED.',
      'Defer to the IRB; the platform plays no role in field selection.',
    ],
    correctIndex: 1,
    topic: 'ethics',
    explanation:
      'Data minimisation is a baseline ethics requirement (HHS Common Rule 45 CFR 46.116, EU GDPR Art. 5(1)(c)). The platform should only release fields the analytic question genuinely requires — even when a DUA is signed. The DUA records terms; it does not waive the minimisation duty.',
  },
  {
    id: 'q2-reid-knn',
    prompt:
      'A "de-identified" patient dataset has age (binned to 5-year buckets), 3-digit ZIP, and admission date. A researcher claims this is safe under HIPAA Safe Harbor. The k-anonymity principle suggests:',
    choices: [
      'Safe Harbor lists 18 identifiers; if none of those are present, the data is anonymous.',
      'Three quasi-identifiers (age, ZIP, date) often uniquely re-identify rows; k-anonymity must be verified empirically.',
      'k-anonymity only matters for genomics datasets.',
      'Date is never re-identifying because it can be shifted by a constant offset.',
    ],
    correctIndex: 1,
    topic: 'reidentification',
    explanation:
      'Sweeney (2000) and follow-ups show 87% of US individuals are uniquely identified by {DOB, gender, 5-digit ZIP}. 3-digit ZIP + date offsets the risk somewhat but does NOT remove it; k-anonymity (often k≥5) must be verified on the actual data, not assumed from the Safe Harbor list.',
  },
  {
    id: 'q3-reid-membership',
    prompt:
      'You publish a model trained on a sensitive dataset and release the model weights. A researcher reports they can determine, with high confidence, whether a specific patient was in the training set. This is:',
    choices: [
      'Not a privacy issue because the patient data is not directly extractable.',
      'A membership-inference attack — a real privacy risk that may require differential privacy or model-output guards.',
      'Only a problem if the model is open-source.',
      "Inevitable for any neural network and therefore not the platform's concern.",
    ],
    correctIndex: 1,
    topic: 'reidentification',
    explanation:
      'Membership inference (Shokri et al. 2017) is a concrete privacy attack on ML models. Mitigations include differential privacy during training, output gating, or restricting model release to a controlled environment. The platform should treat this as a real risk class, not an artifact.',
  },
  {
    id: 'q4-dua-share',
    prompt:
      'You are approved for access to a CONTROLLED-tier dataset. A colleague at a different institution asks you to share a copy because their access request is pending. The DUA you signed:',
    choices: [
      'Only restricts re-publication, not informal sharing.',
      'Binds you to not transfer the data to anyone outside the named project team — informal sharing is a breach.',
      'Only applies to clinical-care use, not research.',
      'Allows sharing as long as the colleague will eventually be approved.',
    ],
    correctIndex: 1,
    topic: 'dua',
    explanation:
      'Standard OCI DUA prohibits transfer outside the named project team. Even short-term informal sharing — including pending-approval colleagues — is a breach and a notifiable incident. The colleague should request access through the platform; pending status is not a workaround.',
  },
  {
    id: 'q5-dua-derivative',
    prompt:
      'You used a CONTROLLED dataset to train a model. The DUA prohibits "redistribution of the data". Your trained-model weights:',
    choices: [
      'Are always safe to release because they are not "the data".',
      'May be a derivative work bound by the DUA — depends on whether the weights leak training-set information (membership inference, model inversion).',
      'Are exempt from any DUA term.',
      'Must be released openly; the DUA cannot restrict scientific outputs.',
    ],
    correctIndex: 1,
    topic: 'dua',
    explanation:
      'Whether trained weights are a "derivative" of the data is a contested but real question. The DUA terms typically govern derivative works that may leak training-set information. When in doubt, ask the data host before releasing weights — this is a standard step in the OCI workflow.',
  },
  {
    id: 'q6-irb-need',
    prompt:
      'A US researcher wants to analyse de-identified imaging data from an EU clinical trial. The data is fully Safe-Harbor de-identified. IRB approval is:',
    choices: [
      'Not required for de-identified data anywhere in the US.',
      "Not US IRB-required if the data is genuinely de-identified per HHS, but the data's source IRB may still impose conditions; the platform respects the source-side requirement.",
      'Required only if the analysis will be published.',
      'Always required for any human-subjects data, regardless of de-identification.',
    ],
    correctIndex: 1,
    topic: 'irb',
    explanation:
      'US Common Rule (45 CFR 46.102(e)(4)) excludes secondary research on de-identified data from "human subjects research". BUT the source IRB conditions still apply — many EU / Swiss IRBs require a specific use to be declared regardless of de-identification status. The platform honours the source-side condition.',
  },
  {
    id: 'q7-irb-secondary',
    prompt:
      'You obtained IRB approval for a "diabetic retinopathy detection" study. You now want to extend the dataset use to glaucoma detection. The IRB approval:',
    choices: [
      'Covers any imaging analysis — IRB approval is dataset-scoped.',
      'Is project-scoped to the originally-stated aim. A new aim requires an amendment or new submission.',
      'Lapses automatically when the project changes scope.',
      'Is irrelevant once the data is in the platform.',
    ],
    correctIndex: 1,
    topic: 'irb',
    explanation:
      'IRB approvals are project-scoped to the originally-stated aim. "Mission creep" into a new aim requires either an amendment to the existing approval or a new submission. The platform asks the requester to attest to the project scope at request time precisely so this is auditable.',
  },
  {
    id: 'q8-ethics-coercion',
    prompt:
      'A startup proposes to use a CONTROLLED dataset to build a commercial diagnostic product. The data was collected under broad-consent terms that permit "research use". Commercial product development is:',
    choices: [
      'Always covered by "research use".',
      'Often outside the scope of "research use" in broad-consent forms; the platform should mark NCU and route through case-by-case review.',
      'Only a concern if the product targets the same patients.',
      'Allowed if the institution gets a royalty share.',
    ],
    correctIndex: 1,
    topic: 'ethics',
    explanation:
      'Broad-consent "research use" is most often interpreted to exclude commercial product development. DUO term DUO_0000046 (NCU) encodes this. OCI Platform routes commercial requests on NCU datasets through case-by-case host review (#119).',
  },
  {
    id: 'q9-reid-aggregate',
    prompt:
      'A dataset publishes only summary statistics (mean, count, percentile) per condition. Membership privacy is:',
    choices: [
      'Always preserved — aggregates leak nothing.',
      'Compromisable by intersection / differencing attacks even from low-dimensional aggregates; differential privacy is the rigorous defence.',
      'Only at risk in genomics.',
      'Equivalent to releasing the raw data.',
    ],
    correctIndex: 1,
    topic: 'reidentification',
    explanation:
      'Differencing attacks (Dwork & Naor 2008) recover individual values from sequences of aggregate queries. Differential privacy bounds the leak, regardless of side-information. Naive aggregate release is not safe in the limit.',
  },
  {
    id: 'q10-dua-incident',
    prompt:
      'You discover that a CSV containing CONTROLLED-tier data was accidentally committed to a public GitHub repo for 6 hours before being removed. Per the OCI DUA you should:',
    choices: [
      'Take no action since the repo is now private.',
      'Notify the dataset host immediately and document the timeline; assume the data may have been mirrored.',
      'Wait to see if the host notices.',
      'Only notify if the data was downloaded by an external party.',
    ],
    correctIndex: 1,
    topic: 'dua',
    explanation:
      'Standard DUA includes a notification clause: incidents must be reported to the host within 24-72 hours regardless of perceived severity. Once data is on a public service, even briefly, you cannot assume it has not been mirrored.',
  },
  {
    id: 'q11-ethics-bias',
    prompt:
      'A model is trained on imaging data from a single hospital network. Deployment in a different country shows worse performance. This is:',
    choices: [
      'Not an ethics issue — performance variance is normal.',
      'A real fairness concern (distributional shift / spectrum bias); the deployment plan must acknowledge it and the regulatory submission must report stratified performance.',
      'Only a concern for FDA-regulated devices.',
      'Sufficiently addressed by adding more training data.',
    ],
    correctIndex: 1,
    topic: 'ethics',
    explanation:
      'WHO and FDA guidance on AI in health both require stratified performance reporting across deployment populations. Spectrum bias (Ransohoff & Feinstein 1978) is a long-standing concern in diagnostic-test evaluation; AI tools inherit it. Cross-jurisdiction deployments amplify it.',
  },
  {
    id: 'q12-reid-genome',
    prompt:
      'A dataset contains "anonymous" whole-genome sequences. A researcher demonstrates re-identification by linking to a public genealogy database. This shows:',
    choices: [
      'Genomes can usually be safely shared as anonymous because of their size.',
      'Genome sequences are inherently identifying (uniquely linkable to family relations); CONTROLLED tier with DUA is the minimum responsible posture.',
      'Re-identification is a problem only for very large genomes.',
      'The genealogy database should be shut down.',
    ],
    correctIndex: 1,
    topic: 'reidentification',
    explanation:
      "Genomes are inherently identifying — Erlich et al. (2018) showed >60% of US individuals can be linked to a relative via public genealogy databases. There is no responsible 'fully anonymous genome' concept. CONTROLLED tier + DUA + use-case review is the minimum.",
  },
  {
    id: 'q13-dua-export',
    prompt:
      'A dataset host based in the EU grants access to a researcher in a country without an EU adequacy decision. The transfer:',
    choices: [
      'Requires no special handling — the data is research data.',
      'Triggers GDPR Chapter V transfer rules (Standard Contractual Clauses, Transfer Impact Assessment, or equivalent); the host must complete this before granting.',
      'Is automatically forbidden.',
      'Only matters if patient identifiers are present.',
    ],
    correctIndex: 1,
    topic: 'dua',
    explanation:
      'GDPR Chapter V (Articles 44-49) governs cross-border transfers of personal data, including pseudonymised research data. Schrems II (CJEU 2020) requires a Transfer Impact Assessment in addition to SCCs. The platform helps hosts surface this requirement at request time.',
  },
  {
    id: 'q14-irb-vulnerable',
    prompt:
      'A researcher wants to analyse a dataset of paediatric MRIs. Compared to an adult-only dataset, the IRB scrutiny is:',
    choices: [
      'Identical — IRB approval is binary.',
      'Generally more rigorous; "vulnerable populations" trigger additional review and may require parental-consent attestations even for de-identified data.',
      "Lighter because children's data is less sensitive.",
      'Only relevant for interventional studies.',
    ],
    correctIndex: 1,
    topic: 'irb',
    explanation:
      "Paediatric, pregnant, and incapacitated populations are 'vulnerable' under 45 CFR 46 Subpart D + EU CTR. IRB review is more rigorous, parental consent provisions apply, and many host datasets impose additional DUA terms.",
  },
  {
    id: 'q15-platform-audit',
    prompt:
      'After approving an access request, a host wants to know who downloaded what and when. The OCI Platform:',
    choices: [
      'Does not log access — that is the requester’s responsibility.',
      'Maintains an audit log per dataset access (who, when, which distribution); hosts can review it on-demand.',
      'Only logs failed accesses.',
      'Logs only the first download per requester.',
    ],
    correctIndex: 1,
    topic: 'dua',
    explanation:
      'OCI Platform maintains an audit log of every distribution access. Hosts can review the log to detect anomalies (off-hours bulk downloads, high-volume re-pulls, etc.) and feed findings into the DUA-compliance workflow.',
  },
] as const);

export const QUIZ_DATA_ETHICS_V1: QuizDefinition = Object.freeze({
  certificationType: 'data_ethics_v1',
  title: 'OCI Data-Ethics Certification (v1)',
  passMarkPercent: 80,
  validityDays: Number(process.env.OCI_QUIZ_VALIDITY_DAYS ?? '365'),
  questions: QUESTIONS,
});

/**
 * The single live quiz for #117 ships under `data_ethics_v1`. Future
 * versions register a new entry here and the platform requires
 * passing the *current* version to lift score → QUIZ_PASSED.
 */
export const QUIZZES: Readonly<Record<string, QuizDefinition>> = Object.freeze({
  data_ethics_v1: QUIZ_DATA_ETHICS_V1,
});

export const ACTIVE_QUIZ_TYPE = 'data_ethics_v1' as const;
