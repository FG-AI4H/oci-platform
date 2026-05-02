# Reference links

## Internal — strategy & history

- [Modernization assessment](./platform-modernization-assessment.md) — full technical decision document
- [OCI 2026-2027 milestones](./oci-milestones-2026-2027.md) — package roadmap aligned with WG-Data
- [Annotation gap analysis](./annotation-project-gap-analysis.md) — what was reported vs. shipped
- [Modernization project items](./modernization-project-items.md) — flat list of GitHub issues
- [Activity history 2022–2026](./activity-history-2022-2026.md) — monthly reports archive
- [Security remediation 2026-03-02](./security-remediation-2026-03-02.md) — March campaign
- [WG-Data Terms of Reference](./WG-Data_Terms_of_Reference.docx)
- [Architecture summary](./architecture.md)
- [Getting started](./getting-started.md)
- [Deployment](./deployment.md)
- [Security baseline](./security.md)
- [Strangler-fig migration plan](./migration/strangler-plan.md)
- [ADR template](./adr/0000-template.md)

## Internal — projects

- [GitHub Project #3 — GI-AI4H Open Code Infrastructure](https://github.com/orgs/FG-AI4H/projects/3) — implementation plan
- [`FG-AI4H/annotation-tool`](https://github.com/FG-AI4H/annotation-tool) — issue host repo
- [`FG-AI4H/oci-platform`](https://github.com/FG-AI4H/oci-platform) — this monorepo

## Legacy repos (being absorbed)

- [`fgai4h-evaluation-platform`](https://github.com/FG-AI4H/fgai4h-evaluation-platform) — current eval/challenge platform (Django + AngularJS) → absorbed Phase C
- [`annotation-tool`](https://github.com/FG-AI4H/annotation-tool) — Spring Boot annotation backend → absorbed Phase B
- [`annotation-frontend`](https://github.com/FG-AI4H/annotation-frontend) — React/CRA annotation UI → absorbed Phase B
- [`Reporting-Package`](https://github.com/FG-AI4H/Reporting-Package) — current reporting work (Golam) → wrapped Phase D

## External standards & specifications

- [WG-Data Terms of Reference (FG-AI4H)](./WG-Data_Terms_of_Reference.docx)
- [MLCommons Croissant](https://docs.mlcommons.org/croissant/)
- [BIOCroissant](https://github.com/mlcommons/croissant) — healthcare extension (in development)
- [HL7 FHIR R4](https://hl7.org/fhir/R4/)
- [DICOM](https://www.dicomstandard.org/)
- [SNOMED CT](https://www.snomed.org/)
- [ICD-11 (WHO)](https://icd.who.int/)
- [LOINC](https://loinc.org/)
- [UMLS (NLM)](https://www.nlm.nih.gov/research/umls/)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) — DMXP compatibility target
- [WHO AI for Health guidance (2024)](https://www.who.int/publications/i/item/9789240084759)

## AWS / framework references

- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [AWS CDK API reference](https://docs.aws.amazon.com/cdk/api/v2/)
- [cdk-nag rules (AwsSolutions)](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md)
- [AWS GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)

- [NestJS docs](https://docs.nestjs.com/)
- [Next.js docs](https://nextjs.org/docs)
- [Prisma docs](https://www.prisma.io/docs)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/)
- [BullMQ](https://docs.bullmq.io/)
- [Zod](https://zod.dev/)

## AWS resources (account 601883093460, eu-central-1)

See [`/Users/mlecoultre/src/oci-eval/fgai4h-evaluation-platform/CLAUDE.md`](https://github.com/FG-AI4H/fgai4h-evaluation-platform/blob/main/CLAUDE.md) for the legacy account-level resource inventory (cluster names, queue names, ARNs).

The new platform's resources are all created by `infra/cdk/`.

## People

- **Marc Lecoultre** (mlecoultre@owt.swiss · marc.lecoultre@itu.int) — lead architect, WG-Data Co-Chair
- **Eva Keller** (eva.keller@itu.int) — full-stack support, ITU
- **Simao Campos** (simao.campos@itu.int) — ITU-T sponsor, monthly activity report recipient
- **Bilel Jamoussi** (bilel.jamoussi@itu.int) — ITU-T director
- **Luis Oala** (luis.oala@dotphoton.com) — WG-Data Co-Chair
- **Golam** — Reporting-Package lead
- **Thanh, Khoa** — Vietnam dev team (backend / frontend on annotation-tool)
