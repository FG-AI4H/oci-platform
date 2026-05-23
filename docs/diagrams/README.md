# Architecture diagrams

PlantUML diagrams describing the OCI Platform infrastructure. Each `.puml`
file declares its source of truth at the top — the diagrams are kept
manually, but should match the CDK code in `infra/cdk/`.

## Files

| File                                                             | Description                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [oci-dev-runtime.puml](./oci-dev-runtime.puml)                   | Runtime architecture for the `dev` environment — Route 53, ALB (TLS), ECS Fargate, Aurora, Cognito, S3, KMS, observability. |
| [oci-deploy-control-plane.puml](./oci-deploy-control-plane.puml) | CI/CD control plane — GitHub Actions to AWS via OIDC, ECR push, CloudFormation/CDK deploy.                                  |

## Rendering

- **Web:** paste contents into <https://plantuml.com/plantuml>
- **CLI:** `plantuml docs/diagrams/oci-dev-runtime.puml` produces a PNG/SVG next to the file
- **VS Code:** the _PlantUML_ extension previews on save (set
  `plantuml.server` to `https://www.plantuml.com/plantuml` for offline-friendly
  rendering)

The diagrams use plain PlantUML primitives (rectangles, clouds, actors,
notes). No external sprite libraries — render works offline once you have
PlantUML installed locally, and online renderers don't need to fetch
anything beyond the diagram source.

## Conventions

- Solid arrows = synchronous calls / data flow on the request hot path
- Dotted arrows = async / metadata / out-of-band calls (logs, secrets reads, JWKS)
- Greyed-out resources = not yet provisioned (e.g., `int` / `prod` envs during Phase A2)
- Resource names match CDK construct names (`oci-{env}-*` pattern)

When a stack changes, update the matching `.puml` and call out the change in
the PR description so the diagram doesn't drift.
