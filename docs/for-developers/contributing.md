# Contributing

Pull requests welcome. The project enforces a strict verification gate but the conventions are stable and well-documented — once you've done one PR the next ones go quickly.

## Before you start

1. Read the project [`CLAUDE.md`](../../CLAUDE.md) — the hard rules (latest stable deps, no secrets in repo, AWS only via CDK, three environments, strict TypeScript, ADR for cross-cutting decisions).
2. Set up locally — see [local-setup.md](./local-setup.md).
3. Find an issue you want to work on, or open one for what you have in mind.

## The orchestrator skills

We have project-scoped Claude Code skills that scaffold features following our conventions. Even when working manually, they're the best reference for "the right way to do this":

- [`.claude/skills/oci-feature-scaffold/`](../../.claude/skills/oci-feature-scaffold/) — new NestJS module (apps/api).
- [`.claude/skills/oci-web-feature-scaffold/`](../../.claude/skills/oci-web-feature-scaffold/) — new Next.js route (apps/web).
- [`.claude/skills/oci-fullstack-feature-scaffold/`](../../.claude/skills/oci-fullstack-feature-scaffold/) — orchestrate both halves with a shared contract.
- [`.claude/skills/db-migration/`](../../.claude/skills/db-migration/) — Prisma schema + migration.
- [`.claude/skills/cdk-stack-add/`](../../.claude/skills/cdk-stack-add/) — new AWS resource.
- [`.claude/skills/security-review/`](../../.claude/skills/security-review/) — pre-merge security check.
- [`.claude/skills/ui-ux-expert/`](../../.claude/skills/ui-ux-expert/) — visual + a11y audit.
- [`.claude/skills/adr-create/`](../../.claude/skills/adr-create/) — Architecture Decision Record.

Even if you don't run them, read the SKILL.md — it captures the patterns you should follow.

## Conventions

- **TypeScript strict.** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an `@ts-expect-error` and an issue link.
- **Zod for inputs, plain interfaces for outputs.** Both halves of the platform import request shapes from `@oci/shared-types` and validate at boundaries; outputs are type-only.
- **Repository pattern.** Prisma calls live only in `*.repository.ts`. Services are pure-ish; controllers are thin.
- **Errors as typed exceptions.** `BadRequestException`, `NotFoundException`, `ForbiddenException`, `ConflictException`. The global filter maps to RFC 7807.
- **Tests co-located.** `*.spec.ts` next to source. Vitest for unit, Playwright for E2E. Integration against real Postgres via Testcontainers (where applicable).
- **Co-author attribution.** PRs that used Claude Code include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## The verification gate

Before opening a PR:

```bash
pnpm --filter @oci/shared-types build
pnpm --filter @oci/api typecheck
pnpm --filter @oci/api test
pnpm --filter @oci/web typecheck
pnpm --filter @oci/web lint
pnpm --filter @oci/web exec playwright test
```

If you touched UI: also run `/ui-ux-expert` and confirm axe deltas are flat or improved. If you touched docs-relevant flows: update the audience docs (the orchestrator skill's step 9 enumerates which audience).

CI re-runs everything plus Trivy + Gitleaks + CycloneDX SBOM. PRs don't merge unless CI is green.

## Commit messages

Conventional commits, scoped:

```
feat(catalog): structured intended use + DUO matching (PR J.1, #94)
fix(api): tsx-watch decorator metadata DI failure
test(web): Playwright suite for host workflow
docs(for-hosts): DUO terms guide
```

Long bodies are encouraged for non-trivial changes — explain _why_, not _what_. Examples:

- [PR I commit](https://github.com/FG-AI4H/oci-platform/commit/0203b48) — multi-section "API / Web / Infra / Schema / Tests" structure for a feature-spanning PR.
- [PR J.1 commit](https://github.com/FG-AI4H/oci-platform/commit/) — "Croissant package / Schema / API / Web / Tests" with explicit out-of-scope for the follow-up.

## ADRs

Open one when:

- You're changing a workstream-wide concern (auth model, validation pattern, error envelope, deployment shape).
- You're picking between multiple reasonable options and want the rationale recorded.
- You're locking in a third-party dependency that's hard to swap.

Use the [`adr-create` skill](../../.claude/skills/adr-create/), or copy [`docs/adr/0000-template.md`](../adr/0000-template.md). ADRs are sequentially numbered and immutable once accepted.

## What we don't accept

- New secrets in the repo. `.env.example` only.
- New AWS resources outside CDK.
- New Python (other than `apps/worker-eval`, the sandbox runner).
- New Spring Boot / Java code (the legacy annotation-tool is being absorbed module by module into NestJS).
- Major dependency upgrades without an ADR + a 48h soak in `dev` before promotion.

## Where to ask

- File issues at `FG-AI4H/oci-platform`.
- Architecture / ADR drafts: open a PR to `docs/adr/` with `0000-`-prefixed draft.
- Standards questions: GI-AI4H WG-Data mailing list.
