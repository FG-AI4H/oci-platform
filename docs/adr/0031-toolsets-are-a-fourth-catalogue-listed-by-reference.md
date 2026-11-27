# ADR-0031: Toolsets are a fourth catalogue, listed by reference

- **Status:** proposed
- **Date:** 2026-11-27
- **Deciders:** Marc Lecoultre
- **Tags:** `area:catalog` | `package:DAP` | `phase:C`

## Context

The platform has three catalogues: datasets, described in Croissant; models, described by a model
card; evaluation tasks, described in Croissant Tasks. The AI for Good Lab's requirements list a
fourth kind of resource a sandbox publishes and discovers: toolsets, meaning notebooks, simulators
and code (Req-003, Req-009, Req-010). At the Lab call of 27 November 2026 notebooks and simulators
were named as the tools that go with a model
([#830](https://github.com/FG-AI4H/oci-platform/issues/830)).

Today nothing on the platform can say "this notebook reproduces the baseline on that dataset" or
"this simulator generates data for that task". A developer can write a link in a model card's free
text, where nobody finds it and nothing links back.

Three facts shape the decision:

1. **The platform evaluates; it does not run other people's code on request.** The one place code
   runs is the sealed evaluation runner, under a contract and a security review of its own
   ([#414](https://github.com/FG-AI4H/oci-platform/issues/414)). Hosting notebooks that execute is a
   different product.
2. **"Tool" already has a meaning here.** An annotation tool integration (MONAI Label, a DICOM
   viewer) is a runtime contract between the platform and a tool it hands a task to (ADR-0007). A
   notebook somebody publishes is not that.
3. **The Lab has not yet given examples** of the toolsets it wants listed, nor said what a user
   should be able to do with one. Whatever is built now must be easy to extend and cheap to change.

## Decision

1. **A fourth resource type, `Toolset`.** Its kind is one of `NOTEBOOK`, `SIMULATOR`, `LIBRARY`,
   `PIPELINE`, `OTHER`.

2. **By reference only.** The platform stores a description and a web address. It hosts no code
   and executes nothing. The address points to where the toolset lives: a repository, a registry,
   a landing page.

3. **A small set of fields:** identifier, name, kind, summary, address, licence, version,
   maintainer, contact, and the datasets and model cards of this platform it works with. The links
   are soft references by identifier, as an evaluation task names its dataset, so a toolset
   survives a dataset or a model being retired.

4. **Described with schema.org `SoftwareSourceCode`,** as JSON-LD on the toolset's page: `name`,
   `description`, `codeRepository`, `license`, `version`, `maintainer`. These are the terms CodeMeta
   builds on. No vocabulary of our own.

5. **Three states.** `DRAFT`: seen by the person who declared it and by operators. `PUBLISHED`:
   public. `WITHDRAWN`: no longer listed, terminal. Anyone signed in may declare a toolset; an
   operator (`admin`) publishes it; its declarer or an operator withdraws it. A public page of
   outbound links is worth a look by a second person before it goes up. Whether publication is
   reviewed at all is open for datasets as well
   ([#691](https://github.com/FG-AI4H/oci-platform/issues/691)); the answer there applies here.

6. **Links follow the catalogues' own visibility.** A toolset can name only the datasets and model
   cards its declarer can see. A reader is shown only the links they may see; the others are left
   out, without a trace.

7. **The word is "toolset",** in the interface, the API (`/v2/toolsets`) and the database, never
   "tool". "Tool" stays with the annotation tool integrations of ADR-0007.

## Consequences

**Positive**

- A notebook or a simulator can be found from the platform, with its licence and what it works
  with, next to the datasets, models and tasks it concerns. Req-003, Req-009 and Req-010 have a
  first answer.
- No new execution surface, no new storage, no new security boundary.
- The fields are additive: when the Lab's examples arrive, a field is added without touching the
  rows that exist.

**Negative, and what is not included**

- **Links rot.** Nothing checks that an address still answers. The same holds for referenced
  dataset files today.
- **The licence is declared, not verified.** The platform shows what the declarer wrote.
- **Nothing runs.** A user who wants to run a notebook does so elsewhere.
- **Not federated yet.** Toolsets are not in any index a peer harvests; that belongs with the
  federation of model cards and tasks
  ([#824](https://github.com/FG-AI4H/oci-platform/issues/824)).
- **Not in the use-case suggestions yet**
  ([#829](https://github.com/FG-AI4H/oci-platform/issues/829)).
- **An operator has one more queue**, until #691 is decided.

## Alternatives considered

- **Hosted notebooks that execute (a JupyterHub next to the platform).** Rejected for now. It is a
  compute and training product, with its own isolation, quota and cost questions, and it would let
  arbitrary code near data the platform holds. The Lab has not asked for it in terms that would
  justify that.
- **Describe a toolset as a dataset, in Croissant.** Rejected. Croissant describes data: record
  sets, fields, distributions. A notebook has none of them, and a catalogue entry that validates
  as a dataset would be listed as one by every harvester.
- **Keep the links in the model card's text.** Rejected. Free text cannot be searched by kind, has
  no licence field, and gives no way back from a dataset to the tools that use it.
- **Extend the annotation tool integration.** Rejected. That record carries launch URLs, callback
  contracts and capability flags for a tool the platform drives. A reference to someone's
  repository needs none of it, and mixing the two would blur a security-relevant registry.

## References

- [#830](https://github.com/FG-AI4H/oci-platform/issues/830): the ticket; part of
  [#585](https://github.com/FG-AI4H/oci-platform/issues/585).
- [ADR-0007](./0007-annotation-tool-integration-contract.md): what "tool" means on this platform.
- schema.org [`SoftwareSourceCode`](https://schema.org/SoftwareSourceCode); the
  [CodeMeta](https://codemeta.github.io/) terms built on it.
