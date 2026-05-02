# Annotation Project — Gap Analysis
## Reported in monthly activities vs. actually shipped in code

**Repos analysed:**
- Backend: `/Users/mlecoultre/src/annotation-tool/` (Spring Boot 3.2.5 / Java 17, last commit 2024-11-02 cherry, last merged PR 2024-10-28)
- Frontend: `/Users/mlecoultre/src/annotation-frontend/` (React 18 + MUI, last commit 2024-11-06)

**Activity-history source:** `docs/activity-history-2022-2026.md` (June 2022 – Apr 2026)

**Method:** for each annotation-related feature mentioned in monthly reports, cross-checked code by searching domain entities, controllers, services, helpers, frontend views/components, and git log. Classified as **Implemented (✓)**, **Partially implemented (◐)**, **Not implemented (✗)**, or **Removed / decayed (⊘)**.

---

## Summary

The annotation mono-repo implements the **core campaign / task / dataset / user model** and has **functioning Croissant ingestion, AWS Glue catalog integration, Cognito auth, and an MUI-based React UI with Kanban + dashboard**. However, **a substantial fraction of features that have been reported to Simao do not appear in the code** — either they were never merged, were prototyped elsewhere (in OCI evaluation platform, or out-of-band), or were deprioritised after the project went into maintenance mode in late 2024.

**Notable absences:** federated learning (KubeFATE / FATE / Inpher), pre-annotation engine, FHIR storage backend, annotation-conflict management, consent management, burndown chart, decentralised auditing (LLM assessment), Visian 3D annotation integration in code, and the Croissant aggregator / WG-Data alignment work.

---

## Implemented (✓) — features in both reports and code

| Feature | Reported (month) | Where in code |
|---|---|---|
| **Campaign management entity + REST API** (CRUD + status transitions) | Sep 2022, Apr 2023, Mar 2023 | `domain/campaign/` — `CampaignController`, `CampaignService.startCampaign`, `CampaignEntity` with status field |
| **Task generator** | Mar 2023 | `CampaignService.generateTasks(UUID)` |
| **Annotation task / sample model** | Apr 2023 | `domain/task/{TaskEntity, AnnotationTaskEntity, AnnotationEntity, SampleEntity}` |
| **Annotators / Reviewers / Supervisors roles** | Apr 2023 (campaign lifecycle) | `domain/user/` — `AnnotatorEntity`, `ReviewerEntity`, `SupervisorEntity`, `UserEntity` with role refs |
| **AWS Cognito user / IDP integration** | Mar 2023 | `helpers/AWSCognito.java`, `idpId` on `UserEntity` |
| **Dataset management** (CRUD + metadata) | Apr–May 2023 | `domain/dataset/{DatasetEntity, DatasetMetadataEntity (~30 metadata fields), DatasetController, DatasetService}` |
| **Local + linked datasets** | Mar 2023 | `DatasetEntity.storageLocation`, `DataCatalogEntity` linkage |
| **AWS Glue data catalog** integration | May–Jul 2023 | `helpers/{AWSGlue, GlueClientFactory}`, `DataCatalogController`, `DataCatalogService` |
| **AWS Athena query** | Jul 2023 | `helpers/{AWSAthena, AthenaClientFactory}` |
| **Catalog tables incl. partitions** | Jun 2023 | `DataCatalogEntity` + Glue partition references in helpers |
| **Data-access requests** (request/grant flow) | (implicit in admin features) | `domain/catalog/DataAccessRequestEntity`, `DataAccessRequestForm` (frontend) |
| **Dataset role / permissions search** | Jun–Nov 2024 (frontend commits "search-permission") | `DatasetRoleController`, `DatasetRoleService`, `components/DatasetPermission/` |
| **Croissant ingestion endpoint** | Apr 2025 (file_record → fileset), Feb 2025 | `DatasetService.ingestCroissant`, frontend `DatasetCroissantModal` |
| **AWS Lambda invocation for Croissant ingest** | Feb 2025 | `helpers/AWSLambda.java`, called from `DatasetService.ingestCroissant` |
| **AWS Secrets Manager** | (security work, multiple) | `helpers/SecretsManager.java` |
| **OAuth2 resource server** (JWT) | (auth work, ongoing) | `pom.xml` — `spring-boot-starter-oauth2-resource-server`, `org/fgai4h/ap/security/` |
| **Java 21 / Spring 3.2.5 migration** | May 2024 | `pom.xml` confirms `spring-boot-starter-parent 3.2.5`, Jakarta packages |
| **Admin portal** (catalog services definition) | Jun 2023 | `domain/admin/{AdminController, AdminService}`, frontend `views/AdminHome/`, `views/CatalogManagement/`, `views/CatalogEdit/` |
| **Frontend: Datasets / Campaigns / Tasks / Tools / Users views + edit** | continuous | `views/{DataStoreHome, CampaignList, CampaignEdit, TaskList, TaskEdit, ToolManagement, UserManagement, …}` |
| **Frontend: Kanban view of campaign progress** | Aug 2024 | `components/KanbanBoard/` (with `@dnd-kit` drag-and-drop) |
| **Frontend: Dashboard / KPIs (campaign progress)** | Sep 2024 ("create dashboard"), Aug 2024 | `components/CampaignProgress/` (Nivo pie charts), commit `743c320 feature: create dashboard` |
| **Frontend: image preview + zoom** | Jun 2022 (dataset previews) | `views/DatasetEdit/ImagePreview/`, `react-medium-image-zoom` dep |
| **Frontend: SonarCloud / GitHub Actions code-quality** | Sep 2022, Mar 2024 | `sonar-project.properties`, `.github/workflows/codeql.yml`, `maven.yml` |
| **OpenAPI-generated DTOs** | Jan, Feb, Mar 2024 ("Api generated" commits) | `target/generated-sources/openapi/`, `src/main/resources/api/openapi.yaml` |

---

## Partially implemented (◐) — feature exists but is incomplete or abandoned

| Feature | Reported (month) | Status in code |
|---|---|---|
| **Pre-annotation engine** | Mar 2023 ("Pre-annotation engine"), Apr 2023 (HPI Docker), May 2023 ("SSO integration for pre-annotation module") | `CampaignEntity` has fields `preAnnotationTool`, `preAnnotationModel` — **schema only, no service / controller / pipeline glue**. No grep hits for "preAnnotation" outside the entity. |
| **AI annotation tool ↔ OCI integration** (HPI Docker) | Apr 2023 (SSO), May 2023 (received Docker, installed on AWS), Jun 2023 (Docker AI annotation integration) | Backend has generic `AnnotationToolEntity` with `name`, `description`, `editor` only — **no Docker invocation, no SSO bridge, no per-tool config**. Effectively a registry stub. |
| **Visian 3D annotation integration** | Jun 2022, Sep 2022, Jun 2023 (OCI/Visian integration support) | Frontend `components/CampaignTask.js`, `views/TaskList`, `views/TaskEdit` only **reference Visian by name** (likely a `<a href>` or external launch). **No embedded viewer / no protocol integration**. Backend: zero hits. |
| **Campaign statistics features** | Jul 2024 ("campaign statistics features") | `CampaignProgress` exists with **hardcoded campaign UUID** (`'02725a0e-9c72-43bb-b88d-5c2819c5ddf3'` in `useEffect`) — clearly demo state, not production-wired. |
| **Burndown chart** | Oct 2024 ("burndown chart and image annotation progress") | **Not present.** No "burndown" hits anywhere; only Nivo pie chart in `CampaignProgress`. |
| **Image-annotation progress** (within dashboard) | Oct 2024 | Pie chart of task statuses exists; no per-image progress visualisation. |
| **OCI fork documentation** | Apr-Jul 2024, Aug 2024 ("Continuation of documentation") | `documentation/{Data-annotation, Campaign-management, Dataset-management, Entities, Data-point-annotation, CICD}.md` exist but are short stubs (e.g. `Campaign-management.md` is 27 lines). |
| **Backend automated tests** | May 2024 ("adding automated test") | `pom.xml` has `spring-boot-starter-test` and `spring-security-test`; minimal test coverage in repo (a few tests under `src/test/`). Not a comprehensive suite. |
| **Infrastructure-as-code for AWS auto-deploy** | Jun 2024 | `Infrastructure/` folder exists at repo root — depth not analysed, but it was reported as "to be continued"; no CI workflow visibly references it. |
| **TG-Symptom integration on OCI platform** | Jun 2022, Mar 2023 ("Onboarded TG-Symptom") | No TG-Symptom-specific code; integration was likely external/configurational. |
| **Botnar feedback documentation** | Dec 2024, Oct 2024 (Botnar prep) | Documentation folder exists; depth of "Botnar-driven" updates not visible in code. |
| **TOR data handling** | Nov 2024 | Likely document-only deliverable (ToR). No code artefact. |
| **Front-end deployment pipeline** | Nov 2024 | No `Dockerfile` / no CI workflow visible in the frontend repo (no `.github/workflows/` checked). To verify. |

---

## Not implemented (✗) — reported but no trace in either repo

| Feature | Reported (month) | Comment |
|---|---|---|
| **Federated learning — KubeFATE / FATE deployment** | Jul-Sep 2023 (multiple months) | Zero hits for `federat`, `FATE`, `KubeFATE` in `src/main`. The KubeFATE work appears to have been an AWS-EKS / infra exercise, not embedded in the annotation tool. |
| **Inpher federated learning collaboration** | Jul-Sep 2023 | No code artefact in either repo. |
| **OCI ↔ Federated-learning instance link** | Aug 2023 ("Linked with KubeFATE federated-learning instance") | Not present. |
| **Federated data-sharing platform integration** | Dec 2023 ("Continuation of OCI code base integration with Federated learning and Federated data sharing platform") | Not present. |
| **Data-sharing agreement implementation** | Jul-Aug 2023 ("Implemented data sharing agreement", "Improved data sharing agreement") | No `agreement` / `DUA` / `dataSharingAgreement` entities or service. May have been a document-only deliverable. |
| **Annotation conflict management** | Oct 2024 | Zero hits for `conflict` outside generic error enum (`DomainError`). The reviewer/supervisor model exists in `UserEntity` but no conflict-resolution workflow or entity. |
| **Consent management for datasets** | Oct 2024 ("Improve consent management for datasets") | Zero hits for `consent` in either repo. `DatasetMetadataEntity` has many privacy fields but no consent-record entity, no consent-revocation API. |
| **FHIR storage backend (HAPI FHIR)** | Feb 2024 (HAPI FHIR analysis), Feb 2025 (FHIR exploration) | Backend code references an old AWS FHIR S3 bucket (`fhir-service-dev-fhirbinarybucket-yjeth32swz5m`) hardcoded in `CampaignService` — **the same FHIR stack that was decommissioned in March 2026 security remediation** (see `docs/security-remediation-2026-03-02.md`). HAPI FHIR migration was researched but not built. |
| **Cluster of VMs for high-load image-annotation** | Sep 2024 | Likely AWS-side EKS deployment; no Kubernetes manifests in repo. |
| **AWS S3 capacity testing (TB-scale)** | Sep 2024 | Operational test, no code artefact expected. |
| **Beanstalk → ECS hosting migration** | Oct 2024 | No `Dockerfile` / `task-definition.json` / `appspec.yml` visible at top of annotation-tool repo (would need a deeper check). The reported migration likely targeted **OCI evaluation platform**, not annotation-tool. |
| **LLM assessment architecture / agentic implementation (LangChain / LangGraph)** | Apr-Dec 2025 (TG-Symptom workshops, ongoing) | **Not annotation-tool work** — landed in the OCI evaluation platform / out-of-band. Confirm this is intentionally outside this repo. |
| **Croissant aggregator for OCI** | Jun 2025 ("Defined the Croissant aggregator…collecting all Croissant compatible dataset for the OCI data catalogue") | Annotation-tool has **single-dataset Croissant ingestion** only. The aggregator described is platform-level and not in this repo. |
| **Sagebase.org API integration** | Apr-Jul 2025 | No Sagebase / Synapse client in code. |
| **AWS Glue crawlers adapted for Croissant** | Mar 2025 | Glue helpers are present but not Croissant-specific; no crawler config code. Likely AWS-console / IaC work outside the repo. |
| **Decentralised auditing concept ("bringing evaluation to the algorithm")** | Jan 2025 | Concept-only, never coded into either repo. |
| **Data-mesh concept note for data handling and sharing** | Feb 2023 | Document-only deliverable. |
| **DevSecOps methodology / security toolchain** | Sep 2022 | Partially reflected via SonarCloud + CodeQL; the broader methodology document not in repo. |
| **Botnar presentation / refresh** | Oct 2024, Nov 2024 | Out-of-repo (slide decks). |
| **Trip / onboarding ceremonies** (Vietnam, HPI, etc.) | multiple | Operational, not code. |

---

## Removed or decayed (⊘) — code that exists but appears stale or unused

| Item | Evidence | Comment |
|---|---|---|
| **Hardcoded FHIR S3 bucket** | `CampaignService.java:98` — `"fhir-service-dev-fhirbinarybucket-yjeth32swz5m"` | The FHIR dev CloudFormation stack was deleted in March 2026 (`security-remediation-2026-03-02.md`). This code path is **dead** and will fail at runtime. |
| **Demo UUID in `CampaignProgress`** | `components/CampaignProgress/index.js` — `'02725a0e-9c72-43bb-b88d-5c2819c5ddf3'` hardcoded instead of `props.campaign.id` | Likely a "wire it up later" placeholder that never got fixed. |
| **`tasks.json.old`** in `src/main/resources/` | Filename | Stale artefact. |
| **Frontend AWS SDK v2** (`aws-sdk@^2.1130.0`, 2022 era) | `package.json` | Should be migrated to AWS SDK v3 modular packages. |
| **AWS Amplify v4 + `@aws-amplify/ui-react@^2.13.0`** | `package.json` | Both several major versions behind current (Amplify is v6 by 2026). |
| **react-scripts 5.0.1** | `package.json` | CRA is deprecated; project would benefit from migration to Vite. |
| **OpenAPI generator artefacts checked in?** | `src/main/gen/api/openapi.yaml` exists | Generated artefacts ideally not in VCS. |

---

## Repository activity timeline (correlate with reports)

```
Backend (annotation-tool):
  2023-03-15  — last activity until late 2023
  2023-11-29  — pom upgrade (#66)
  2023-12-04  — codeql + maven workflow updates (#74-78)
  2024-01-09  — OpenAPI generated (#81-83)
  2024-02-25  — OpenAPI generated (#86)
  2024-03-04  — OpenAPI generated (#87)
  2024-04-30  — Documentation added (Contributing, Data-annotation, Entities)
  2024-05-01  — OpenAPI generated (#89)
  2024-05-09  — Campaign management documentation (#90)
  2024-05-20  — Refactoring (#93)
  2024-06-26  — Refactoring + datasetRole endpoints (#94-95)
  2024-07-05  — Feature/fixes (#96)
  2024-10-28  — Feature/fixes (#97, #100) — LAST major activity
  2024-11-02  — Last commit (tasks-by-campaign fix)

Frontend (annotation-frontend):
  2024-06-21  — sonar setup, refactor structure (#28-31)
  2024-06-26  — search & grant user permission
  2024-07-02  — permissions integration
  2024-07-09  — fix edit cover image, link dataset
  2024-08-01  — feature: create dashboard
  2024-11-03  — Integrate API for Dashboard
  2024-11-06  — Last commit (search-permission merge)
```

The repos clearly went quiet from **early November 2024 onwards**. Reports from 2025 onwards (LLM assessment, Croissant aggregator, WG-Data work, AI4G challenge support) are **all OCI-evaluation-platform / external** work — confirming the user's earlier intuition that the annotation-tool moved to maintenance mode.

---

## Recommendations for next steps

1. **Decide the annotation-tool's strategic future** before doing any cleanup. The repo has ~18 months of accumulated debt. Options:
   - **Sunset** — archive both repos; the OCI evaluation platform absorbs annotation features as needed.
   - **Reactivate** — define a 2026-Q3 milestone (e.g. integration with WG-Data / BIOCroissant) and reinvest.
   - **Narrow scope** — keep the dataset/Croissant/catalog parts (which are useful); drop the campaign/task parts which overlap with OCI.

2. **Quick wins if reactivated:**
   - Remove the dead FHIR bucket reference in `CampaignService.java:98` (will cause production failures if/when invoked).
   - Wire `CampaignProgress` to real `props.campaign.id`.
   - Bring AWS SDK v2 → v3 (frontend) and Amplify v4 → v6.
   - Remove generated OpenAPI artefacts from VCS.

3. **Annotation-conflict + consent management** — reported in Oct 2024 but never implemented. If the project continues, these are **WG-Data-relevant** (privacy-preserving exchange / consent ledger) and would tie back to OCI's DAP package.

4. **Pre-annotation pipeline** — schema fields exist in `CampaignEntity` but no service. If reactivated, this is a natural integration point with the LLM assessment work happening in OCI evaluation platform — could become "model-in-the-loop" annotation.

5. **Federated-learning code** — fully outside both repos. If federated training remains a strategic theme (per WG-Data WS-3 privacy-preserving exchange), accept that it lives in a third location (KubeFATE on AWS EKS) and document where.

6. **Documentation accuracy** — the existing `documentation/` folder has stub files. If the project is reactivated, expand them; if sunset, mark them clearly as historical.
