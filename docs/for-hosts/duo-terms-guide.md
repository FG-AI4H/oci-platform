# DUO terms — choosing the right ones

Your dataset's **DUO consent codes** tell requesters and the platform's auto-matcher what your dataset permits. Pick them deliberately: under-restricting invites uses you didn't intend; over-restricting starves legitimate research.

This guide walks the choices for the terms the platform's matcher understands today. The full GA4GH ontology has ~30 terms; we surface the ones that meaningfully change a host's review workload.

## How to attach DUO terms to your manifest

In your Croissant 1.1 manifest, under `consentCode`:

```jsonc
{
  "consentCode": [
    {
      "@type": "sc:DefinedTerm",
      "@id": "http://purl.obolibrary.org/obo/DUO_0000042",
      "termCode": "DUO_0000042",
      "name": "general research use",
    },
    {
      "@type": "sc:DefinedTerm",
      "@id": "http://purl.obolibrary.org/obo/DUO_0000021",
      "termCode": "DUO_0000021",
      "name": "ethics approval required",
    },
  ],
}
```

Multiple terms compose. A dataset can declare one **permission** (the "what's allowed") plus zero or more **restrictions** (narrowing) and **modifiers** (additional duties).

For non-PUBLIC datasets you must declare at least one term. The publish endpoint fails closed without one.

## Permissions — pick exactly one (usually)

Permissions describe the broad scope. Pick the most permissive one you're comfortable with.

| Code                 | Term                                         | Use when…                                                                             | Don't use when…                                     |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `DUO_0000004` (NRES) | No restriction                               | Truly open data; anyone may use for any purpose.                                      | You have any concerns. NRES is rare.                |
| `DUO_0000042` (GRU)  | General research use                         | The data is for research without domain restriction; commercial research is OK.       | You want to scope to health/medical only — use HMB. |
| `DUO_0000006` (HMB)  | Health, medical or biomedical research       | Health-domain data where non-health uses don't make sense (and would dilute consent). | The data has obvious non-health applications.       |
| `DUO_0000007` (DS)   | Disease-specific research                    | The data was collected to study a specific disease and you want use scoped to it.     | The data is general health data; pick HMB instead.  |
| `DUO_0000011` (POA)  | Population origins or ancestry research only | Population genetics / ancestry datasets with no other research justification.         | Most clinical datasets.                             |

## Restrictions — pick zero or more

Restrictions narrow what's allowed. Use them sparingly; each one is a reason for the matcher to flag a request.

| Code                   | Term                                    | Use when…                                                                                     |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DUO_0000046` (NCU)    | Non-commercial use only                 | The data may not be used for commercial product development or paid services.                 |
| `DUO_0000045` (NPUNCU) | Not-for-profit, non-commercial use only | Stricter than NCU: also excludes for-profit-but-not-commercial-product use.                   |
| `DUO_0000016` (GSO)    | Genetic studies only                    | The data may only be used for genetic studies (no behavioural, environmental, etc. analyses). |

## Modifiers — additional duties on the requester

Modifiers don't restrict the scope; they impose obligations.

| Code                | Term                             | Effect                                                                                                                      |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DUO_0000021` (IRB) | Ethics approval required         | Requester must attest to IRB / ethics committee approval. The matcher rejects requests where `irbApproved=false`.           |
| `DUO_0000019` (PUB) | Publication required             | Requester must publish results. The matcher accepts the declared output type.                                               |
| `DUO_0000020` (COL) | Collaboration required           | Requester must collaborate with the data provider / primary investigators. **Triggers UNCLEAR** — needs a formal agreement. |
| `DUO_0000024` (MOR) | Publication moratorium           | Publication is held until a date the data provider sets. **Triggers UNCLEAR.**                                              |
| `DUO_0000029` (RTN) | Return to database               | Derived data and annotations must be returned. **Triggers UNCLEAR.**                                                        |
| `DUO_0000026` (US)  | User-specific restriction        | Use restricted to a specific named user. **Triggers UNCLEAR.**                                                              |
| `DUO_0000027` (PS)  | Project-specific restriction     | Use restricted to the project named in the original request. **Triggers UNCLEAR.**                                          |
| `DUO_0000028` (IS)  | Institution-specific restriction | Use restricted to the requesting institution. **Triggers UNCLEAR.**                                                         |

**UNCLEAR** in the matcher means: "this is fine _if_ a formal data-use agreement is signed". The platform's DUA generation lands in PR J.2; today, when a requester selects an UNCLEAR-triggering term, the host inbox tells you to negotiate manually before approving.

## Common combinations

| Dataset profile                                          | Recommended terms                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Open public benchmark, any use                           | `DUO_0000004` (NRES)                                                                 |
| General clinical-research benchmark                      | `DUO_0000042` (GRU) + `DUO_0000021` (IRB)                                            |
| Disease-specific cohort, non-commercial                  | `DUO_0000007` (DS) + `DUO_0000046` (NCU) + `DUO_0000021` (IRB)                       |
| Sensitive disease-specific cohort with return-of-results | `DUO_0000007` (DS) + `DUO_0000046` (NCU) + `DUO_0000021` (IRB) + `DUO_0000029` (RTN) |
| National cohort with collaboration requirement           | `DUO_0000006` (HMB) + `DUO_0000020` (COL) + `DUO_0000021` (IRB)                      |

## Anti-patterns

- **No DUO terms on a non-PUBLIC dataset.** The publish endpoint rejects this; the matcher would always return UNCLEAR. Pick the most permissive term that fits.
- **Stacking restrictions that don't add information.** `NCU` + `NPUNCU` is redundant — NPUNCU implies NCU. Just use NPUNCU.
- **Using DS without naming the disease.** GA4GH expects DS to be paired with the disease term. Today the OCI's matcher treats any DS as "partial — host eyeballs the project description"; the disease-fit check is a v2 enhancement.
- **Using US/PS/IS instead of just denying broadly.** If your data is genuinely for one named user/project/institution, that user/project/institution is who should publish the dataset, not someone else with a US/PS/IS modifier.

## Changing terms after publish

Re-publish the manifest with updated `consentCode`. Existing access-request rows keep the dataset DUO terms they were _matched against at request time_ (frozen in `Dataset.duoTerms` snapshot on the request) — your inbox still shows the right terms for old requests, while new requests match against the new terms.
