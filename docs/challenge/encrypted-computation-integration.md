# Integration note for encrypted-computation routes (Track B)

GI-AI4H Benchmarking Challenge · WG-Data · version of 25 October 2026

**For route providers on the encrypted-computation track.** The
[conformance specification](./conformance-specification.md) is written to be neutral between
approaches, which leaves a cryptographic route underspecified. This note says where such a route has
to meet the platform. Where it is more specific than the specification, it narrows it; it never
relaxes it.

---

## 1 Who is who

Four parties take part in a run, and they are distinct.

| Party                 | Holds                                                        | Never sees                              |
| --------------------- | ------------------------------------------------------------ | --------------------------------------- |
| **Data host**         | The evaluation data and its reference labels                 | The model in plaintext                  |
| **Model developer**   | The model                                                    | The data, or per-item outputs           |
| **Route provider**    | The protocol and its implementation                          | Anything the protocol does not give it  |
| **Platform operator** | The route registry, dispatch, the results record, publishing | The data, the model, any decryption key |

**The data host is not the platform operator.** The platform registers routes, dispatches runs,
records every result with the route version that produced it, and publishes. It holds no decryption
keys, and it has no GPUs.

## 2 Where the computation runs

The route is **model-to-data**: the model is encrypted and sent to the data host, and the host
evaluates the encrypted model on its own data. The computation therefore runs on the **data host's
hardware**, as the host declares it. The challenge has no hardware budget and the platform provides no
compute for runs.

This formulation keeps the data inside the host for the whole run. What crosses a boundary is the
encrypted model and the encrypted output.

**On the reference task**, the data and labels are public, so no host secret is at stake. For the
demonstration, the route provider may run the data-host side on its own hardware. Say so in the
declarations, and run it exactly as a host would.

Testing and debugging happen on your own hardware. They are development of the route, not evaluation.

## 3 Who learns the per-item outputs

**Per-item predictions are learnt only by the party that scores them**: the platform on the reference
task, the data host on a host's task. The model developer receives aggregate metrics and nothing per
item ([§2.3](./conformance-specification.md#23-returning-a-result)).

Under model-to-data, the encrypted output is decryptable by whoever holds the model key, which is
usually the model developer. The protocol must therefore stop decryption from handing the developer
per-item plaintext. Masking the output before it is sent for decryption, or threshold decryption with
the shares delivered to the scoring party, both meet this. Declare which you use. A protocol in which
the developer decrypts per-item outputs does not.

On the reference task this would do no harm, since everything is public. The demonstration must still
exercise the same flow a host's task would use, because a protocol shown only in a form that would
disclose on a host's task demonstrates nothing.

## 4 What the route returns

| Task               | Returns                                                                                                                                                                       | Scored by     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Reference task     | Per-item integer labels in `[0, 4]`, keyed on the published item identifiers, in the `predictions.json` shape ([§2.2](./conformance-specification.md#22-executing-the-model)) | The platform  |
| A data host's task | Metrics, computed by the host against its own labels                                                                                                                          | The data host |

Never both, never neither, and never patient-level data or model internals. A failure returns one of
the classified codes in §2.3. A failure specific to encryption, such as a decryption error, maps to
`INTERNAL_ERROR` or `TIMEOUT`; if you need a code that does not exist, ask rather than invent one.

## 5 Who computes the published metric

On the reference task, the platform does, from the labels the route returns.

On a host's task, the host does, and the platform records that the host computed it. The result is
published with that fact and with the route version. In Phase 1 the platform does not verify the
host's arithmetic. The cryptography protects the model; it says nothing about whether the host
reported the metric honestly. That rests on the host, contractually, and the disclosure profile must
say so.

## 6 The three declarations for a cryptographic route

The [three declarations](./conformance-specification.md#3-what-a-solution-must-declare) apply as
written. For a cryptographic route they need the following in particular.

**Threat model.**

- The scheme, the hardness assumption the guarantee rests on, the parameter set and the security
  level it gives.
- Who generates each key, who holds it, and at which step it is used.
- What the host learns from evaluating the encrypted model even when the cryptography holds: the
  architecture's shape (layer dimensions, depth, where activations are approximated), run time and
  memory. Either defend against these or list them as out of scope.
- At least one explicit out-of-scope item. A threat model with none will not pass review.

**Disclosure profile.**

- What each of the four parties in §1 observes before, during and after a run.
- Two trust anchors, stated separately: cryptographic for the model's confidentiality, contractual
  for the honesty of a host-computed metric (§5).
- Who holds decryption keys, and how the protocol keeps per-item outputs from the developer (§3).
- Whether a run is reproducible. Approximate schemes add noise, so say whether the output is
  deterministic and, if not, how a reviewer reproduces a result within a stated tolerance.

**Operational envelope.**

- Permitted operations, for example linear layers and polynomial activations up to a stated degree.
- Arithmetic precision, and how the scheme's approximation is controlled.
- The runtime cap per run, at most **24 hours** (86,400 seconds), and the memory cap.
- The hardware a host must provide to run it within those caps.
- What a model developer must change for a model to run under the route, such as replacing
  activations with polynomial approximations or staying under a maximum depth.
- Once measured, the **fidelity gap** (§7) and the **cost**: wall-clock time per item and per run,
  peak memory, and the hardware it was measured on.

Declared caps are enforced, not documented (§3.3 of the specification). A cap the implementation does
not apply is a conformance failure.

## 7 What the fidelity gap is measured against

The **same model**, with the same weights, run once in plaintext and once through the route, on the
thirty reference items. The gap is reported on every `GRADING` metric: quadratic-weighted kappa,
accuracy, referable sensitivity, referable specificity and coverage. If the route's output varies
from run to run, report the mean gap and its spread over a stated number of runs.

The reference task's item identifiers and labels are public on purpose. It measures what protection
costs against a plaintext baseline, not skill on hidden labels, so knowing the items gives nothing
away.

## 8 Dates

| Date                         | What                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| 1 November 2026              | Track B opens                                                                         |
| Until 18 December, 23:59 UTC | Submit the declarations and a runnable implementation; both may be changed until then |
| After 18 December            | Declarations frozen; technical review and adversarial testing                         |
| January 2027                 | Phase 1 results published                                                             |

The track is scoped to **inference, not training**.

## 9 What is not built yet on the platform

Stated plainly, as the specification does for its own gaps. The platform-side adapter that
dispatches a run to an encrypted-computation route and takes in its result is in progress
([#413](https://github.com/FG-AI4H/oci-platform/issues/413)), and so is pinning the route version on
every submission ([#583](https://github.com/FG-AI4H/oci-platform/issues/583)). Neither blocks the
declarations or the implementation, and both are ours to finish before review.

## 10 Submitting

Write to `marc.lecoultre@itu.int` with the three declarations and a reference to a runnable
implementation, including how to run the data-host side. Routes are integrated by the platform rather
than self-served (§9 of the specification).
