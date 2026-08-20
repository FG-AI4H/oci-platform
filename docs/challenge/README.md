# GI-AI4H Benchmarking Challenge

Participant-facing documentation for the **GI-AI4H Benchmarking Challenge** — an open global
challenge that evaluates health AI models on real clinical data without that data being disclosed to
the model developer, and without the model being disclosed to the institution holding the data.

Organized by the WG-Data working group of the Global Initiative on AI for Health (ITU · WHO · WIPO),
co-organized by CAICT in collaboration with Tsinghua University.

| Document                                                    | For                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| [FAQ](./faq.md)                                             | Anyone — deadlines, eligibility, submission limits, task data  |
| [Conformance specification](./conformance-specification.md) | Solution providers — what an entry must satisfy to be accepted |

## The short version

**Phase 1** (now to December 2026) calls for the _privacy-preserving evaluation solutions_
themselves — sealed execution, encrypted computation, confidential computing, federated evaluation —
validates them against a common reference task, and collects the clinical use cases Phase 2 will run
on. Results are published in January 2027.

**Phase 2** (2027) evaluates AI models on real clinical data for the use cases collected, with the
data remaining where it is.

Phase 1's primary call is for **solutions, not models**. That is the most common misreading, and
[the FAQ](./faq.md) opens with it.

## Roles

| Role                  | Contributes                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| **Solution provider** | A working privacy-preserving evaluation solution. Phase 1's primary call.      |
| **Data host**         | A clinical evaluation task and dataset that stay under the host's own control. |
| **Model developer**   | An AI model to be evaluated through the available solutions.                   |

Participation is free of charge. Organizations may act in more than one role, but may not submit
models to tasks they contribute.

## Links

- Challenge page: [competition.aiforgood.itu.int — challenge 493](https://competition.aiforgood.itu.int/web/challenges/challenge-page/493/overview)
- Contact: `marc.lecoultre@itu.int`
