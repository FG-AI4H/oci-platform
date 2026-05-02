# Activity History — Marc Lecoultre, OCI / GI-AI4H
## Compiled from monthly reports to Simao Campos (ITU-T)

**Period covered:** June 2022 – April 2026
**Source files:** `/activities/*.eml` — monthly activity emails (both standalone "Activities <month>" threads and the SSA contract-approval / payment threads where Marc summarised the month's work)
**Purpose:** Reference history for gap analysis on the **OCI evaluation platform** (this repo) and the **annotation mono-repo** (`/Users/mlecoultre/src/annotation-tool/` + `/annotation-frontend/`).

---

## 2022

### June 2022 *(reported 2022-06-20)*
**AWS Infrastructure**
- Inventoried provisioned resources, labelled them, removed unused (~25% cost reduction in progress)
- Automated GitHub-based deployment with hooks
- Refactored repos: split frontend and backend

**Software development**
- Documented architecture; started a Confluence space using ARC42 template
- Annotation backend: campaign management (Tasks, Annotators, Reviewers, Managers); annotation task management
- Dataset management: secure storage via FHIR; list datasets and edit metadata; image previews via S3 + Lambda on-the-fly resizing

**Integrations**
- Visian (3D annotation, HPI students) integrated
- TG-Symptom: provided endpoints; analysing hosting compatibility

**Organisational**
- HPI students: planning the next batch (continued Visian work)
- Botnar grant work
- Weekly integration + OCI management meetings

### Coverage gap: Jul–Aug 2022, Oct–Dec 2022

### September 2022 *(reported 2022-09-19)*
- Main focus on security and privacy
- Wrote DevSecOps methodology, processes, guidelines, toolchain
- Secured dev environment (IDE, plugins)
- Secured CI/CD with ITU and AWS security engineers
- SonarCloud for code quality; quality gates in pipeline
- Developer onboarding doc; service requests via GitHub
- Migrated reporting/assessment platform to ITU GitHub account
- Enforced MFA on GitHub
- Recruited 7 HPI students (Potsdam) for 1 year of OCI work
- Continued annotation platform development; data storage implementation
- FG-AI4H meetings

---

## 2023

### January 2023 *(reported 2023-01-22)*
- AI pre-annotation for 2D image segmentation with HPI student
- Defined interfaces between annotation tool and AI annotation tool
- Continued annotation standard work (presentation planned for March meeting)
- AWS infra refactoring
- Support to developers on GitHub automation
- OCI meetings, management meetings

### February 2023 *(reported 2023-02-15)*
- Supervised AI annotation project with HPI students
- Implemented interfaces between annotation tool and AI annotation tool
- Continued annotation standard work (annotation methods for images, processes, requirements)
- Drafted concept on annotation workshop
- Onboarded a CHUV team on AI annotation for brain vessels
- Concept note for data handling and sharing using data-mesh principles
- Looking for additional OCI developers
- OCI meetings, management meetings

### March 2023 *(reported 2023-03-22)*
- Supervised AI annotation project with HPI students
- OCI platform: dataset management (local + linked); campaign management, task generator; admin / user management linked with AWS Cognito; annotation tools and tasks
- Implemented interfaces with annotation tool — pre-annotation engine
- Continued annotation standard work (methods, processes, requirements, campaign management)
- Onboarded TG-Symptom on the OCI platform
- Looking for additional OCI developers
- FG_Meeting Boston

### April 2023 *(reported 2023-04-26)*
- Supervised AI annotation project with HPI students
- Designed POC for shared data platform on AWS
- OCI platform: campaign lifecycle (review/validation); recommendations from the annotation standard
- SSO integration for AI-based annotation tool (HPI)
- Continued annotation standard: alignment with Xhan; document restructure
- Recruiting OCI developers
- OCI meetings, management meetings

### May 2023 *(reported 2023-05-23)*
- HPI annotation project: received AI-based annotation Docker, installed on AWS; SSO integration for pre-annotation; OCI integration
- Created AWS Glue data catalog and linked to OCI (Data Hub project)
- OCI platform: campaign lifecycle; annotation-standard recommendations
- Annotation standard: alignment with Xhan; document restructure
- Looking for OCI developers in Vietnam
- OCI meetings, management meetings
- Conference "AI in Croatia" — presented OCI

### June 2023 *(reported 2023-06-20)*
- HPI annotation project: integration of Docker AI-based annotation into OCI; team support on OCI/Visian integration; final presentation prep (Berlin, July 6)
- Added data to AWS Glue catalog (Europe + South America regions)
- Integrated catalog tables in OCI (partitions)
- Synced with Ferath about FG-AI4H final-demo datasets
- Updated OCI frontend AWS configuration (security compliance)
- OCI platform: campaign lifecycle; admin portal for catalog services; annotation-standard recommendations
- Continued annotation standard work
- OCI meetings, management meetings
- Conference "AI in Croatia" — presented OCI

### July 2023 *(reported 2023-07-18)*
- FG-AI4H meeting (July 3-6)
- HPI annotation project: final presentation (Berlin, July 6); recorded intro video for final defense
- Prepared FG-AI4H meeting demo and presentation; collected progress from teams
- Configured AWS data crawlers (Europe / South America)
- Integrated catalog tables in OCI (partitions)
- Synced with Ferath about FG-AI4H datasets
- Investigated federated learning solutions: Inpher / KubeFATE
- OCI platform: added data catalog registries
- Defined dataset metadata structure; investigated Croissant standard (with Luis)
- Implemented data-sharing agreement; dataset linkage
- Refactoring per security findings
- OCI meetings, management meetings
- Feedback session with Inpher
- Contacted TrustLay.io for potential collaboration

### August 2023 *(reported 2023-08-20)*
- Synced with Ferath about FG-AI4H datasets
- Continued KubeFATE setup as code (federated learning)
- Reviewed AWS security findings; investigated alternatives for publicly exposed Lambda for S3 dataset storage
- Rewriting OCI website text
- Reviewed Matthew's opinion paper
- Recruiting dev resources in Vietnam
- OCI platform: linked with KubeFATE federated-learning instance
- Continued dataset metadata / Croissant investigation (with Luis)
- Improved data-sharing agreement using Ferath's template
- Refactoring per security findings
- OCI meetings, management meetings

### September 2023 *(reported 2023-09-19)*
**Federated learning**
- Investigated FL frameworks: open-source FATE, commercial Inpher
- Multiple meetings with Inpher about GI collaboration; invited them to Riyadh meeting
- Adapted and provisioned KubeFATE (auto-deploy on AWS EKS)
- Deployed FATE via KubeFATE

**Other**
- Meetings with Data4Life: synergies and collaborations
- Engaged HPI for student teams (continue AI pre-annotation; new project)
- OCI platform: continued dataset metadata / Croissant investigation (with Luis); refactoring per security findings; AWS data-platform exchanges
- OCI meetings (devs, TGs); consultation workshop; management meetings

### Coverage gap: Oct, Nov 2023

### December 2023 *(reported 2023-12-06)*
- OCI Frontend pipeline integration
- Refactoring of Annotation repository — separated frontend from backend
- Enabled code-quality actions on GitHub Actions; fixed issues in backend and frontend
- Continued OCI codebase integration with federated learning and federated data-sharing platform
- Looking for dev resources in Vietnam (3 interested resources)
- Continued OCI development including security findings fix
- Management meetings

---

## 2024

### Coverage gap: Jan 2024

### February 2024 *(reported 2024-02-20)*
- Fixed all security issues from dependencies
- Developed additional OCI feature for annotation campaign management
- Interviews + tech assessment for Vietnam resources (meeting them in March)
- Metadata definition for image data catalogue
- Analysed FHIR server (HAPI FHIR) to replace AWS FHIR implementation
- Researched AWS health platform for large image-DB storage
- Looking for GI sponsors (e.g. Tata Community)

### March 2024 *(reported 2024-03-21)*
- Trip to Vietnam to onboard developer for OCI
- Sourcing additional Vietnam developers; interviews + tech assessment
- Fixed all security issues from dependencies
- Refactored CI/CD pipelines (backend + frontend)
- Changed backend AWS deployment incl. load-balancer + quality check (SonarCloud, GitHub code check)
- Adapted static frontend deployment to comply with security policy disallowing public S3 read
- Participation in writing the final report to SG-16

### April 2024 *(reported 2024-04-19)*
- Participation in writing the final report to SG-16
- Documented OCI package for third-party forks (in progress)
- Onboarded Vietnam developer Thanh; weekly meetings, task assignment, guidance
- Fixed all security issues from dependencies

### May 2024 *(reported 2024-05-20)*
- Continued OCI fork documentation — `github.com/FG-AI4H/annotation-tool/blob/master/documentation/Data-annotation.md`
- Refactored OCI Backend; added automated tests
- Migrated backend to Java 21 and Spring 3.2.5
- Continued onboarding Thanh
- Fixed all security issues from dependencies

### June 2024 *(reported 2024-06-18)*
- Continued OCI fork documentation
- Redeployed GitHub and AWS pipelines (resources had been deleted by someone)
- Created infrastructure-as-code for automated AWS deployment
- Onboarded new front-end Vietnam dev Khoa; weekly meetings
- Reviewing project Kanban on GitHub; task assignment + prioritisation
- Continued work with Thanh (backend)
- Fixed all security issues from dependencies

### July 2024 *(reported 2024-07-18)*
- Continued OCI fork documentation
- Onboarded Khoa on GitHub and AWS
- Daily Scrum + reviews with devs
- Project Kanban on GitHub
- Worked with Thanh (backend)
- Improved retrieval of images from AWS
- Fixed frontend / backend issues
- Added campaign-statistics features, dataset management, task generation
- Fixed all security issues from dependencies

### August 2024 *(reported 2024-08-20)*
**OCI portal improvements (with Vietnam team)**
- Campaign dashboard
- Task management and assignment
- Kanban view of campaign progress (annotation tasks)
- Refactoring for modularity

**Other**
- Travel to Vietnam to meet developers
- Fixing assessment-platform Docker container (security warnings) — heavy lift since original devs unavailable
- Addressed new vulnerabilities; PRs to upgrade libraries
- Continued OCI documentation
- Ticketing system to onboard new devs (GitHub, AWS)

### September 2024 *(reported 2024-09-18)*
- Regular sync with frontend/backend Vietnam devs:
  - Campaign management, reporting, KPIs
  - Continued Kanban view of campaign progress
- Deployed cluster of VMs to handle high-load image-annotation tasks on AWS
- Cluster monitoring + workload-based optimisation
- AWS S3 capacity testing with TB-scale datasets
- Attended AWS Summit Zürich (innovative health-sector solutions)
- Attended Intelligent Health Basel
- Continued fixing assessment-platform Docker container (security)
- Addressed new vulnerabilities; library-upgrade PRs
- Continued OCI documentation
- *Note from Simao: Eva K. to be onboarded soon*

### October 2024 *(reported 2024-10-21)*
- Onboarded Eva
- Botnar meeting prep; refreshed presentation
- **AWS hosting change:** moved OCI from Beanstalk to ECS (Docker-based)
- OCI campaign management: improved dashboard with burndown chart and image-annotation progress
- Improved consent management for datasets
- Annotation conflict management
- Adapted frontend + backend to implement specs
- Sync meetings with developers

### November 2024 *(reported 2024-11-22)*
- Botnar presentation prep + meeting
- TOR data handling
- Weekly meetings with Vietnam devs
- Cleanup project board; replanning of dev backlog
- Front-end deployment pipeline
- Documentation of OCI
- Continued data-annotation standard proposal (with Croissant inputs)
- Multiple dev tickets (backend / frontend, task management, Kanban board, campaign dashboard)

### December 2024 *(reported 2024-12-04)*
- Weekly meetings with Vietnam devs
- Refinement of metadata-management backlog
- Documentation of OCI (per Botnar feedback; meetings foreseen)
- Continued data-annotation standard proposal with Croissant inputs
- Multiple backend / frontend dev tickets, task management, Croissant implementation form, connection to data catalogues

---

## 2025

### January 2025 *(reported 2025-01-20)*
- Weekly meetings with Vietnam devs
- TG-Symptom Assessment meeting: discussed platform upgrade for the TG; introduced to new TG drivers by Henry
- Designed next version of Assessment platform
- Took over codebase for Assessment platform
- Reviewed new EvalAI releases (open-source base of platform)
- Concept work: bringing evaluation to the algorithm (decentralised auditing)
- Plan to replatform the Assessment solution

### February 2025 *(reported 2025-02-19)*
- AWS VPC change → redeployed Elastic Beanstalk environment for OCI backend; required AWS support
- Prep for HealthAI meeting
- Documentation of health-data governance
- Set up data hub + catalogue on AWS, linked with OCI frontend
- Explored AWS Health Data Hub, FHIR
- Integration of Croissant file into OCI; wizard in frontend (in progress)
- AWS Lambda function to ingest Croissant datasets
- Updated assessment platform with latest EvalAI updates (in progress)
- Meetings with Vietnam devs
- Briefing meeting with ITU/WHO/WIPO on WG-Data
- Merged ToR with Luis

### March 2025 *(reported 2025-03-19)*
- Merging of ToR between DASH and DAISAM — meetings + editorial work
- Work on Croissant standard, integration in OCI (in progress)
- Meeting with Sage to access health datasets to develop OCI features (Croissant-format datasets)
- Refinement of Croissant model to incorporate health data
- Adapted AWS Glue crawlers to handle Croissant format (in progress)
- Attended GI-AI4H meetings in Singapore
- Meeting with HealthAI to present OCI work
- Weekly OCI dev meetings
- Fixed new security and deprecation issues on OCI code

### April 2025 *(reported 2025-04-21)*
- Coordination meetings with OCI Vietnam frontend/backend devs
- Fixed dependency vulnerabilities
- **Croissant integration:** organised Croissant-group sync meeting; planned work; access to sample datasets; refactored dataset description (file-record → fileset)
- Continued campaign progress-management features, dashboard, "best next task" for annotators
- Assessment of LLM algorithms in health: prompt engineering, agentic implementation with LangChain, LangGraph

### May 2025 *(reported 2025-05-20)*
- TG-Symptom workshop: assessing LLM models — new challenge
- Designed LLM assessment architecture and process (reusable across TGs)
- Croissant integration with Sagebase.org; defined metadata ingested by OCI via crawlers
- AWS cost reduction
- OCI assessment-platform cluster migration (blocked — separate email)
- Weekly sync with OCI frontend dev
- Security patching
- Migration to new EvalAI version (in progress, major version change)

### June 2025 *(reported 2025-06-20)*
- TG-Symptom workshop: collecting requirements for LLM assessment architecture on AWS
- Iterated on LLM assessment architecture/process
- WG-Data meetings; Croissant alignment; defined Croissant aggregator for OCI
- Sagebase.org API integration work
- AWS cost reduction; resolved Kubernetes cluster version issue (cluster migration)
- Weekly sync with OCI frontend dev
- Security patching
- EvalAI migration continued
- Status meeting on Data WS; drafted status report

### July 2025 *(reported 2025-07-21)*
- Meeting + prep for WHO (Shada): evaluation methodology, OCI tooling — integrating WHO eval framework into OCI
- OCI EvalAI as alternative to AI4Good's custom challenge platform: meeting, POC prep, example challenge setup, results presentation
- Continued TG-Symptom workshops; LLM assessment architecture on AWS
- Iterated on LLM assessment architecture/process
- Weekly sync with OCI frontend dev
- Security patching
- EvalAI migration prioritised (AI4Good interest)
- Status meeting on Data WS

### August 2025 *(reported 2025-08-19)*
**General platform support**
- Finalised OCI migration to latest EvalAI version
- Database migration to most recent AWS service (cost reduction; old DB end-of-life)
- Backend auth/authz changed to use EC2 IAM role instead of access tokens
- Security patching

**Supporting AI4G Challenges** *(per Simao's regrouping for Bilel)*
- Duplicated frontend for AI4Good challenges
- Created new backend instance + database for AI4Good
- Updated networking between OCI services; security improvements
- OCI EvalAI as alternative to custom AI4Good platform — meeting + result presentation

**GI-AI4H**
- TG-Symptom LLM assessment workshops (continued)
- Iterated on LLM assessment architecture
- Weekly sync with OCI frontend dev

### September 2025 *(reported 2025-09-20)*
**General platform support**
- Security patching (incl. response to npm supply-chain attack of September)

**Technical debt addressed**
- Fixed 32+ SASS deprecation warnings; modern HSL/RGB syntax compatibility
- Cleaned up hardcoded paths; standardised file paths

**AWS Infrastructure & DevOps**
- Migrated boto → boto3
- Implemented IAM-role auth (removed hardcoded creds)
- Fixed S3 private-bucket access for challenge files
- Resolved CloudWatch logging region (eu-central-1)
- Fixed ECS task definitions and worker container issues
- Removed sensitive `.env` files from VCS; updated `.gitignore`; private S3 ACLs; Django storage `s3boto → s3boto3`

**Supporting AI4G Challenges — Frontend UI/UX modernization**
- Complete redesign (Kaggle-inspired hero section, partner carousel, Challenge Highlights, Announcements)
- Responsive design across pages; dropdown styling, form layouts
- Modernised challenge-page tabs
- ITU branding integrated; updated logos; replaced CloudCV references; new footer

**Backend improvements**
- Fixed Unicode encoding errors (stdout/stderr file handling)
- Resolved STATSD_PORT config issues
- Improved S3 file access via Django storage
- Fixed challenge config validation for private S3

**Build & Deployment**
- Fixed `vendor.js` / `vendor.css` loading; Angular.js dependency order
- SASS compatibility across 30+ SCSS files
- Cross-browser CSS syntax; Docker build config

**Documentation & Configuration**
- Added AWS configuration reference (`CLAUDE.md`)
- Updated README with production setup; AWS VM recovery process; configuration templates

**GI-AI4H**
- TG-Symptom LLM assessment workshops (continued); architecture iteration
- Weekly sync with OCI frontend dev

### October 2025 *(reported 2025-10-20 — 15-day period)*
**General platform support**
- Security patching
- Implemented custom email backend for AWS SES using IAM role
- Updated production email configuration

**Technical debt** = upgrading older deps (e.g. AWS boto) per Simao's clarification

**AWS Infrastructure & DevOps**
- Fixed UTF-8 encoding issues in submission result/metadata file saving
- Resolved submission form issues
- Fixed S3 URL proxying and presigned URL handling
- Fixed multiple server-URL configuration issues
- Removed cached email-service token
- **Critical fix:** boto3 credential-caching issues causing `InvalidClientTokenId` errors

**Supporting AI4G Challenges — UI/UX**
- Fixed Total Submissions counter visibility
- Enhanced challenge-page styles and organizer logo layout
- Updated contact emails
- Improved challenge list view (start/end dates, prize amounts, status)
- Multi-currency prize display
- Participant team counts in serializer
- Resized/optimised challenge-logo images
- Added `page_image` field to Challenge model; URL transformation; nginx config for `/media/page_images/`

**GI-AI4H**
- TG-Symptom LLM assessment workshops; architecture iteration
- BIOCroissant: new team-member onboarding + planning
- Weekly sync with OCI frontend dev

### November 2025 *(reported 2025-11-18)*
**General platform support**
- Security patching

**Critical infrastructure fixes**
- Fixed AWS credential expiration across all boto3 client/resource creation
- Resolved boto3/botocore version compatibility conflicts
- Pinned awscli version
- Implemented native boto3 credential caching with auto-refresh
- Removed static credential exports causing expiration
- Used temporary credentials for S3 sync

**Performance optimization**
- Module-level caching for boto3 SES clients
- Module-level caching for SQS queues
- Prevented unnecessary recreation of AWS service clients

**Supporting AI4G Challenges**
- Simplified email confirmation page (removed S3 images, cloudcv.org refs)
- Removed GitHub/Twitter social icons
- Fixed login URL paths and domain config (`competition.aiforgood.itu.int`)
- Challenge setup support (date changes, submission testing, coordination with Jiaying)
- Platform monitoring + operations

**GI-AI4H**
- TG-Symptom LLM assessment workshops
- LLM assessment architecture iteration
- BIOCroissant
- Weekly sync with OCI frontend dev
- **Planning WG-Data activities and deliverables for next 9 months**

### December 2025 *(reported 2025-12-12)*
**OCI Platform**
- Restored platform after IT security policy change — coordination with ITU security and BeSharp
- Addressed security improvements per security-team list

**AI4Good**
- Adaptation for SoM challenge
- New OPEA challenge: team onboarding, repository preparation, platform setup

**GI-AI4H**
- Revised the WG-Data ToR
- TG-Symptom LLM assessment workshops; architecture iteration
- BIOCroissant
- Weekly sync with OCI frontend dev

---

## 2026

### January 2026 *(reported 2026-01-21)*
**OCI Platform**
- Fixed cross-origin (CORS) blocking the competition site
- Fixed file-upload errors on challenge create/update
- Fixed timeout errors causing first-request 502s
- Rebranded "EvalAI" → "AI4Good"
- Removed dark mode for consistent appearance
- Added challenge-config troubleshooting docs
- Added T&C document on the challenge platform
- Reviewed new website prototype

**AI4Good**
- Moved KDDI Research Challenge to "Past Challenges"
- Reporting on ongoing challenges
- Multiple modifications to ongoing challenges

**GI-AI4H**
- Reviewed white paper on annotations in dentistry
- Continued TG-Symptom workshops on LLM assessment
- Iterated on LLM assessment architecture/process
- Planning 2026 webinars/workshops on LLM assessment
- BIOCroissant
- Weekly sync with OCI frontend dev

### February 2026 *(reported 2026-02-18)*
**Challenge Management**
- KDDI Research: collected interaction stats over the whole period; addressed organizer requests
- Synesthesia of Machines (SoM) 2025: updated calendar; sponsor logos; restructured partner section; collected stats
- **OPEA Innovation Challenge** new setup (Challenge #492): config (manual eval, single Build & Submit phase); HTML pages (overview, evaluation, T&C, submission, phase); placeholder eval script; live at `competition.aiforgood.itu.int/web/challenges/challenge-page/492/`

**Platform Content & Configuration**
- Added ITU AI/ML Challenge Guidelines 2026 (T&C) PDF; landing-page link; nginx serving
- Fixed nginx node_exporter upstream config (Docker host IP `172.17.0.1`)

**Frontend (in progress)**
- Extended challenge-page CSS to all content sections (evaluation, T&C, submission, phase)
- Fixed font weight (override `.w-300`) and Trix list margin issues
- Bold/strong rendering across content sections

**GI-AI4H**
- Reviewed revised white paper on annotations in dentistry
- TG-Symptom LLM assessment — focus on multi-agent architectures; evaluated AMBOSS paper from Stanford
- Iterated on LLM assessment architecture/process
- Planning call for 2026 webinars/workshops with TG-Symptom
- WG-Data meetings
- BIOCroissant
- Weekly sync with OCI frontend dev

### March 2026 *(reported 2026-03-20)*
**OPEA Challenge Setup**
- Challenge config + evaluation scripts
- Evaluation script, configuration, HTML templates
- Refined phase descriptions and submission guidelines

**AWS Security Remediation** (extensive — also see `docs/security-remediation-2026-03-02.md`):
- **[RDS.2]** RDS public access → fixed via VPC consolidation; EC2 server migrated; ECS workers migrated; public access disabled; 0.0.0.0/0 inbound rules removed
- **[ES.2]** Elasticsearch public access → deleted unused FHIR dev CFN stack (Dec 2020): ES domain, API GW, 5 Lambdas, 3 DynamoDB tables, 5 S3 buckets, 2 Cognito pools, Glue jobs, Step Functions, KMS keys, IAM roles
- **[EC2.19]** Unrestricted SG access → removed all 6 inbound rules from `oci-data-catalog`
- **ECR vulnerabilities (~50K)** → reduced; deleted 19 unused ECR repos; rebuilt+pushed all 9 active prod images; removed stale hardcoded creds (now IAM role)
- Remaining: ~30 critical / ~228 high findings due to pinned app deps (Django 2.2, Pillow 7.1, PyYAML 5.1, ImageMagick 6.9, outdated npm) — needs major Django 2.2 → 4.x upgrade

**Challenge page frontend (ongoing)**
- Continued redesign using Shadcn UI design system

**Platform maintenance**
- KDDI moved Ongoing → Past
- T&C document link on home page; nginx config

**GI-AI4H**
- TG-Symptom LLM assessment workshops; multi-agent focus; AMBOSS paper review (continued)
- Iterated on LLM assessment architecture
- Planning call for 2026 webinars/workshops with TG-Symptom
- WG-Data meetings + content prep
- BIOCroissant
- Weekly sync with OCI frontend dev / SSA job description prep
- Monthly catch-up

### April 2026 *(report not yet sent — Simao requested 2026-04-20)*
- Drafted OCI 2026-2027 milestones aligned with WG-Data ToR — `docs/oci-milestones-2026-2027.md`
- Drafted high-level email summary for Simao to share with Bilel Jamoussi
- Replied to Simao on candidate challenge topics for OCI (TG-Ophthalmo / Diabetic Retinopathy primary; TG-Radio / TB chest X-ray secondary)
- Reviewed `Project_decision_questions_answered.docx`; identified per-page OCI insertion points; addressed Eva Keller's KE2 OCI-perspective comment
- Passed all mandatory ITU and UN trainings (week of Apr 27 – May 1)

### May 2026 — *in progress*
- Resolved AWS Security Hub findings on Aurora MySQL `fg-ai4h-db` (audit logging + CloudWatch export) and S3 access point `eval-prod-ap` (block public access)
- Diagnosed and fixed expired Let's Encrypt cert on `health.aiaudit.org` (had expired 2026-04-23 due to certbot standalone vs Docker port-80 conflict); installed pre/post renewal hooks; verified via dry-run

---

## Coverage gaps

| Period | Gap | Notes |
|---|---|---|
| Jul – Aug 2022 | 2 months | Possibly pre-monthly-reporting cadence |
| Oct – Dec 2022 | 3 months | No archived reports |
| Oct – Nov 2023 | 2 months | Sep was sent late (in Oct thread); Oct/Nov standalone missing |
| Jan 2024 | 1 month | No archived report |
| April 2026 | report owed | Reconstructed from local artefacts |

---

## Themes for gap analysis

The history covers two distinct project tracks. Understanding their relative activity profile is the goal of this archive.

### 1. OCI Evaluation Platform (this repo: `fgai4h-evaluation-platform`)
- Originated as an EvalAI fork; later rebranded to AI4Good
- Active hosting of TG/AI4G challenges (KDDI Research, Synesthesia of Machines, OPEA Innovation)
- LLM assessment architecture — dominant theme since 2025-Q2 via TG-Symptom
- Croissant / BIOCroissant integration via Sagebase.org
- Continuous: AWS cost reduction, security patching, EvalAI major-version migration
- 2024-Q4: hosting platform changed Beanstalk → ECS
- 2025-Q3: full UI/UX modernization, ITU branding rollout, AWS DevOps overhaul
- 2026-Q1: targeted AWS Security Hub remediation campaign

### 2. Annotation mono-repo (`/Users/mlecoultre/src/annotation-tool/` + `/annotation-frontend/`)
- HPI student project (2022-2023): AI-based annotation Docker, SSO, OCI integration
- Spring Boot Java backend; React frontend; FHIR for medical data
- 2022-Q3: DevSecOps foundation work
- 2023: most active period — campaign management, annotation tools, dataset metadata, Croissant standard groundwork
- May 2024: Java 21 / Spring 3.2.5 migration
- Mid-2024: Vietnam dev team (Thanh, Khoa) onboarded
- 2024-Q3 Aug: campaign-statistics, task generation, KPIs
- 2024-Q4: campaign management, annotation conflict, consent management
- 2025-Q1: Croissant model refinement, AWS Glue crawler adaptation
- **From 2025-Q2 onwards:** annotation-tool work all but disappears from monthly reports — focus pivots to OCI evaluation platform / AI4Good challenges
- Last known major code change: November 2024 (per repo's `git log`)

### Cross-cutting themes
- **WG-Data activation in 2025** with Croissant standard alignment (Marc as Co-Chair)
- **WHO engagement** (Shada) starting July 2025
- **Multi-agent / LLM assessment architecture** as the dominant 2025-2026 strategic theme
- **HPI relationship** (Berlin students) carried 2022-2023 annotation work; ended ~mid-2023 final defense
- **Vietnam dev team** picked up annotation-tool maintenance and OCI features 2024-onward
- **Botnar** as primary funder; reviews drive periodic documentation milestones
