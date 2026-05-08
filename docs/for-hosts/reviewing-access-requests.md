# Reviewing access requests

Your inbox lives at `/dashboard/host/access-requests`. Each row is a structured access request from a researcher who wants to use one of your datasets.

The platform does the bookkeeping; you do the judgement.

## What you see per row

```
┌──────────────────────────────────────────────────────────────────────┐
│ Project title                                              [pending] │
│ Dataset name • slug • requester id • submitted <date>  [auto-match] │
├──────────────────────────────────────────────────────────────────────┤
│ ⚠ Why the matcher flagged this                                       │
│  • Dataset is "NCU (Non-commercial use only)" — commercial use      │
│    prohibited. Requester declared "COMMERCIAL_RESEARCH".            │
├──────────────────────────────────────────────────────────────────────┤
│ Description                                                          │
│   <project description>                                              │
│ Institution: …                                                       │
│ Intended use: Non-commercial research                                │
│ Requester's DUO terms:  GRU  PUB                                     │
│ Dataset's DUO terms:    GRU  IRB  RTN                                │
│ IRB: approved (IRB-2026-042)                                         │
│ DPIA: …                                                              │
│ Retention: 365 days                                                  │
│ Redistribution: No redistribution                                    │
│ Output type: Peer-reviewed publication                               │
├──────────────────────────────────────────────────────────────────────┤
│ Decision note (required for DENY) ____________________________       │
│                            [Approve]  [Deny]                         │
└──────────────────────────────────────────────────────────────────────┘
```

## The auto-match badge

Three states. Each is a recommendation, not an enforcement — you can approve a CONFLICT or deny a MATCHED if you have reason to.

### MATCHED (green)

The requester's declared use is **consistent with all your DUO terms**, no formal-agreement modifier blocks approval, and IRB-required terms are met. Default action: **approve**, unless something in the project description changes your mind.

What to scan:
- Does the project description match the project title? (Mismatch = possible cut-paste error.)
- Is the institution legitimate? (You're not the platform's first line of defence here — the OCI requires a verified account — but you're the second.)
- Is the retention window reasonable for the project?

### CONFLICT (red)

The matcher found at least one explicit conflict — typically commercial intent vs NCU, or no IRB on an IRB-required dataset. Default action: **deny**, with a decision note that points the requester to the conflict (the matcher's explanation is right there in the alert).

When to override:
- The matcher was wrong (rare — the conflicts are mechanical). File an issue if it happens.
- You have out-of-band reason to grant the request anyway (e.g. you've signed a side-letter that explicitly waives the restriction). Document it in the decision note for the audit trail.

### UNCLEAR (amber)

The matcher couldn't make a clean call. Two common causes:

- **Formal-agreement modifier present.** Your dataset has `RTN`, `COL`, `MOR`, `US`, `PS`, or `IS`. The platform doesn't yet auto-generate the corresponding Data Use Agreement (PR J.2 territory) — handle the agreement out-of-band, then approve and reference the signed DUA in the decision note.
- **DS (disease-specific) permission.** The matcher can't auto-verify that the requester's project actually targets the named disease. Read the project description; approve if it fits, deny with a note if not.

## Decision mechanics

- **Approve**: requester immediately gains the right to download the dataset's gated distributions. The decision is recorded with your user id, timestamp, and note.
- **Deny**: same recording; requester sees the status flip and (if you wrote a note) the reason. They can file a fresh request with corrections — the old row is immutable.
- **Revoke** (only valid from APPROVED): pulls back access. The requester loses the ability to mint new presigned download URLs; bytes already downloaded are obviously gone from your control. Revoke when:
  - The requester's project changed and the new use is incompatible.
  - The IRB approval was withdrawn / lapsed.
  - You discovered a misrepresentation in the original request.

## Decision notes — what to write

Optional for APPROVE, **strongly recommended** for DENY. Notes are recorded in the audit trail and visible to the requester; they replace the back-and-forth that ten years of email threads have shown to be the slowest part of access-request handling.

Good notes:

- "Approved. Standard data-use rules apply per dataset's GRU+IRB."
- "Denied. Dataset is NCU (non-commercial only); your declared use is commercial. If your funder considers this non-commercial despite the commercial-vehicle relationship, file a fresh request with that justification."
- "Revoked. IRB approval IRB-2026-042 was withdrawn 2026-09-01 per your institution's notice."

Bad notes:

- "OK." (no audit value)
- "See email." (defeats the purpose)
- "Your request is bad." (unprofessional + no actionable feedback)

## Bulk handling

The inbox doesn't yet support bulk actions. If you're routinely seeing dozens of identical-looking requests, that's a signal your DUO terms are too loose (or too tight). Re-read the [DUO terms guide](./duo-terms-guide.md).

## Audit trail

Every decision is recorded. A regulator with audit access can see: dataset, requester, the structured intended-use payload, your decision, your note, the timestamp. Don't write anything in the decision note you wouldn't want a regulator to read.

## Troubleshooting

- **"My inbox is empty."** Either you have no datasets that requesters can hit (PRIVATE drafts only), or you have RESTRICTED datasets and no one's requested yet. Check `/dashboard` for your dataset list.
- **"I approved but the requester says they still can't download."** Check that the dataset is PUBLISHED (not DRAFT) and the distribution is platform-hosted (not upstream — for upstream, the OCI doesn't gate; the upstream host does). Also ask the requester to refresh their dashboard.
- **"I see a request for a dataset I don't recognise."** You're an admin with override visibility. Coordinate with the dataset's actual host before deciding.
