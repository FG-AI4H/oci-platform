import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { ModelFactsLabel } from '@oci/shared-types';
import {
  allowedTransitionsFrom,
  canEditModelCard,
  canTransition,
  isModelCardReviewerGroups,
  mayMoveModelCard,
  modelCardVisibleTo,
  type ChangeModelCardStatusRequest,
  type CreateModelCardRequest,
  type ListModelCardsQuery,
  type ListModelCardsResponse,
  type ListModelCardsForDatasetResponse,
  type ListMyModelCardsResponse,
  type ModelCardDatasetFacts,
  type ModelCardDatasetRef,
  type ModelCardDatasetRefInput,
  type ModelCardDatasetRole,
  type ModelCardEvaluatedOn,
  type ModelCardResponse,
  type PublicModelCard,
  type UpdateModelCardRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { CatalogService, type DatasetReferenceFacts } from '../catalog/catalog.service.js';
import { ModelCardEvidenceService } from '../evaluation/model-card-evidence.service.js';
import { IntendedUseService } from '../intended-use/intended-use.service.js';
import {
  PredictionRepository,
  toModelCardResponse,
  toMyModelCardSummary,
  toPublicModelCard,
  type DatasetRefArgs,
  type ModelCardWithRefs,
} from './prediction.repository.js';
import { buildModelFactsLabel } from './renderers/model-facts-label.js';
import { renderModelFactsMarkdown } from './renderers/render-model-facts-markdown.js';

/**
 * Prediction service (#260, ADR-0013 amended + ADR-0015).
 *
 * Owns the AI-submission lifecycle. The Intended-Use Statement attaches
 * to the model card here — never to a dataset. On submit we re-validate
 * the IUS through `IntendedUseService` (so the risk-tier-override rule
 * from ADR-0013 §2 is enforced identically to the rest of the platform),
 * check the slug is free + any semver parent exists, persist, and emit
 * the `prediction.modelcard.created` audit event (ADR-0014).
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);

  constructor(
    @Inject(PredictionRepository) private readonly repo: PredictionRepository,
    @Inject(IntendedUseService) private readonly intendedUse: IntendedUseService,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
    @Inject(ModelCardEvidenceService) private readonly evidence: ModelCardEvidenceService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async submit(
    body: CreateModelCardRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ModelCardResponse> {
    // The request schema already guarantees the IUS is present + shaped;
    // re-run it through IntendedUseService so the tier-override justification
    // rule (ADR-0013 §2) is enforced consistently. Throws 400 if invalid.
    const ius = this.intendedUse.validate(body.intendedUse);

    if (body.parentModelCardId) {
      const parent = await this.repo.findById(body.parentModelCardId);
      if (!parent) {
        throw new NotFoundException(`Parent model card '${body.parentModelCardId}' not found`);
      }
    }

    const clash = await this.repo.findBySlug(body.slug);
    if (clash) throw new ConflictException(`Model card slug '${body.slug}' already exists`);

    const datasetRefs = await this.datasetRefArgs(body.datasetRefs, user, []);

    const actorUserId = cognitoSubAsUuid(user.sub);
    const created = await this.repo.create({
      slug: body.slug,
      submitterUserId: actorUserId,
      intendedUse: ius,
      modelClass: body.modelClass,
      architectureSummary: body.architectureSummary,
      trainingDataLineage: body.trainingDataLineage,
      parentModelCardId: body.parentModelCardId ?? null,
      versionMajorMinorPatch: body.versionMajorMinorPatch,
      changeJustification: body.changeJustification ?? null,
      materialChange: body.materialChange,
      trainingDataJurisdictions: body.trainingDataJurisdictions,
      datasetRefs,
      generativeAi: body.generativeAi,
      lmmSpecificLimitations: body.lmmSpecificLimitations ?? null,
      modelDeveloper: body.modelDeveloper,
      developerContact: body.developerContact,
      clinicalSummary: body.clinicalSummary ?? null,
      regulatoryApproval: body.regulatoryApproval ?? null,
      knownBiasesOrEthicalConsiderations: body.knownBiasesOrEthicalConsiderations ?? null,
      biasMitigationApproaches: body.biasMitigationApproaches ?? null,
      ongoingMaintenance: body.ongoingMaintenance ?? null,
      securityPosture: body.securityPosture ?? null,
    });

    await this.audit.emitSync({
      module: 'prediction',
      action: 'modelcard.created',
      subjectType: 'model-card',
      subjectId: created.id,
      actorUserId,
      payload: {
        slug: created.slug,
        modelClass: created.modelClass,
        riskTier: ius.riskTier,
        version: created.versionMajorMinorPatch,
      },
    });

    this.logger.log(
      `prediction.modelcard.created slug=${created.slug} class=${created.modelClass} tier=${ius.riskTier}`,
    );
    return this.present(created, user, true);
  }

  /**
   * Edit a card (#651). The rule is `canEditModelCard` in @oci/shared-types:
   * DRAFT only, submitter only. Someone who cannot see the card gets the same
   * 404 as for a missing slug; a reviewer who can see it but did not file it
   * gets a 403; the submitter editing a card that is no longer DRAFT gets a
   * 409, since returning it to DRAFT first would make the edit possible.
   *
   * A new Intended-Use Statement goes through `IntendedUseService.validate`,
   * the same check as on create. The audit event names the changed fields,
   * not their values.
   */
  async update(
    slug: string,
    body: UpdateModelCardRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ModelCardResponse> {
    const existing = await this.findVisible(slug, user);
    const actorUserId = cognitoSubAsUuid(user.sub);
    const isSubmitter = existing.submitterUserId === actorUserId;
    if (!isSubmitter) {
      throw new ForbiddenException(`Only the submitter may edit model card '${slug}'`);
    }
    if (
      !canEditModelCard(existing.status, { isSubmitter, isReviewer: isModelCardReviewer(user) })
    ) {
      throw new ConflictException(
        `Model card '${slug}' is ${existing.status}; only a DRAFT card can be edited`,
      );
    }

    const ius = body.intendedUse ? this.intendedUse.validate(body.intendedUse) : undefined;
    const datasetRefs =
      body.datasetRefs === undefined
        ? undefined
        : await this.datasetRefArgs(body.datasetRefs, user, existing.datasetRefs);
    const updated = await this.repo.update(existing.id, {
      ...body,
      intendedUse: ius,
      datasetRefs,
    });

    await this.audit.emitSync({
      module: 'prediction',
      action: 'modelcard.updated',
      subjectType: 'model-card',
      subjectId: updated.id,
      actorUserId,
      payload: {
        slug: updated.slug,
        fields: changedFields(body),
        riskTier: (updated.intendedUse as { riskTier?: string }).riskTier ?? null,
      },
    });

    this.logger.log(`prediction.modelcard.updated slug=${slug}`);
    return this.present(updated, user, true);
  }

  /** The caller's own cards, every status (#651). */
  async listMine(user: CognitoAccessTokenPayload): Promise<ListMyModelCardsResponse> {
    const rows = await this.repo.listBySubmitter(cognitoSubAsUuid(user.sub));
    return { items: rows.map(toMyModelCardSummary) };
  }

  /**
   * Drive the model-card lifecycle (#432). Transitions are validated against
   * the table in `@oci/shared-types` — an illegal move is a 400 that names the
   * moves actually available, and a no-op re-statement of the current status is
   * a 409 rather than a silent success. Every accepted move emits an audit
   * event (ADR-0014); a rejected one writes nothing.
   */
  async changeStatus(
    slug: string,
    body: ChangeModelCardStatusRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ModelCardResponse> {
    const existing = await this.findVisible(slug, user);

    const from = existing.status;
    const to = body.status;

    if (from === to) {
      throw new ConflictException(`Model card '${slug}' is already ${from}`);
    }
    if (!canTransition(from, to)) {
      const allowed = allowedTransitionsFrom(from);
      throw new BadRequestException(
        allowed.length === 0
          ? `Model card '${slug}' is ${from}, which is terminal — no transitions are allowed`
          : `Cannot move model card '${slug}' from ${from} to ${to}. Allowed: ${allowed.join(', ')}`,
      );
    }

    // Who may make the move: the rule lives in @oci/shared-types
    // (`mayMoveModelCard`) so the web app shows exactly the buttons this
    // check accepts. Submitting is the submitter's act; publishing is a
    // reviewer's, and never the submitter's own card.
    const actorUserId = cognitoSubAsUuid(user.sub);
    const isSubmitter = existing.submitterUserId === actorUserId;
    const isReviewer = isModelCardReviewer(user);
    if (!mayMoveModelCard(to, { isSubmitter, isReviewer })) {
      throw new ForbiddenException(
        to === 'SUBMITTED'
          ? `Only the submitter may submit model card '${slug}'`
          : isSubmitter
            ? `You submitted model card '${slug}' and cannot publish it`
            : `Moving model card '${slug}' to ${to} requires evaluation-reviewer or admin`,
      );
    }

    const updated = await this.repo.updateStatus(existing.id, to);
    await this.audit.emitSync({
      module: 'prediction',
      action: 'modelcard.status.changed',
      subjectType: 'model-card',
      subjectId: updated.id,
      actorUserId,
      payload: { slug: updated.slug, from, to, reason: body.reason ?? null },
    });

    this.logger.log(`prediction.modelcard.status.changed slug=${slug} ${from}->${to}`);
    // Whoever may move a card is its submitter or a reviewer.
    return this.present(updated, user, true);
  }

  /**
   * Render the WHO Fig. 7 Model Facts Label for a model card (#261).
   *
   * Gated on a non-DRAFT status: a draft submission has not been put forward as
   * anything, and publishing a clinician-facing label for it would misrepresent
   * it. That gate is exactly what the `status` field added in #432 exists for.
   *
   * Performance rows come from the evaluation submissions linked to the card
   * (#587), read through `ModelCardEvidenceService`, the evaluation module's
   * typed read, never its repository. That module decides where each result
   * stands (published, provisional, not attributed, retracted) by its own
   * publication rule; the label only lays the answer out, published results
   * apart from the rest, and says in `gaps` what it could not show.
   */
  async modelFactsLabel(slug: string, user?: CognitoAccessTokenPayload): Promise<ModelFactsLabel> {
    const row = await this.findVisible(slug, user);
    if (row.status === 'DRAFT') {
      throw new ConflictException(
        `Model card '${slug}' is DRAFT — a Model Facts Label is only rendered once it is submitted or published`,
      );
    }
    return buildModelFactsLabel({
      card: toModelCardResponse(row),
      performance: await this.evidence.performanceFor(row.id),
      generatedAt: new Date(),
    });
  }

  async modelFactsMarkdown(slug: string, user?: CognitoAccessTokenPayload): Promise<string> {
    return renderModelFactsMarkdown(await this.modelFactsLabel(slug, user));
  }

  /**
   * Fetch one card. The submitter, reviewers and admin get the full card;
   * everyone else, signed in or not, gets the public card (#591). Signing in
   * doesn't make a field any less public: anyone can register an account and
   * read a PUBLISHED card.
   */
  async getBySlug(
    slug: string,
    user?: CognitoAccessTokenPayload,
  ): Promise<ModelCardResponse | PublicModelCard> {
    const row = await this.findVisible(slug, user);
    const privileged =
      user !== undefined &&
      (row.submitterUserId === cognitoSubAsUuid(user.sub) || isModelCardReviewer(user));
    const card = await this.present(row, user, privileged);
    return privileged ? card : toPublicModelCard(card);
  }

  /**
   * The published cards that declare a dataset (#820), for the dataset page.
   * A dataset the caller may not see answers 404, like the dataset itself:
   * otherwise the list would confirm that a private slug exists.
   */
  async listForDataset(
    datasetSlug: string,
    user?: CognitoAccessTokenPayload,
  ): Promise<ListModelCardsForDatasetResponse> {
    const facts = await this.catalog.referenceFacts([datasetSlug], user);
    if (!facts.has(datasetSlug)) {
      throw new NotFoundException(`dataset "${datasetSlug}" not found`);
    }
    return { items: await this.repo.findPublishedByDatasetSlug(datasetSlug) };
  }

  /**
   * The card with its datasets (#820): the declared ones as this caller may
   * see them, and those of its published results.
   *
   * A declared catalogue dataset the caller may not see is `WITHHELD` for the
   * public: role only. The submitter and the reviewers (`privileged`) keep
   * the slug they or the submitter typed, with no facts beside it.
   */
  private async present(
    row: ModelCardWithRefs,
    user: CognitoAccessTokenPayload | undefined,
    privileged: boolean,
  ): Promise<ModelCardResponse> {
    const performance = await this.evidence.performanceFor(row.id);
    const published = performance.entries.filter((e) => e.standing === 'PUBLISHED');
    const slugs = [
      ...row.datasetRefs.flatMap((r) => (r.datasetSlug ? [r.datasetSlug] : [])),
      ...published.map((e) => e.datasetSlug),
    ];
    const facts = slugs.length > 0 ? await this.catalog.referenceFacts(slugs, user) : new Map();

    const datasetRefs: ModelCardDatasetRef[] = row.datasetRefs.map((ref) => {
      const role = ref.role as ModelCardDatasetRole;
      if (ref.datasetSlug === null) {
        return {
          role,
          kind: 'EXTERNAL',
          datasetSlug: null,
          externalUrl: ref.externalUrl,
          externalName: ref.externalName,
          note: ref.note,
          manifestVersion: null,
          manifestSha256: null,
          dataset: null,
        };
      }
      const known = facts.get(ref.datasetSlug);
      if (!known && !privileged) {
        return {
          role,
          kind: 'WITHHELD',
          datasetSlug: null,
          externalUrl: null,
          externalName: null,
          note: null,
          manifestVersion: null,
          manifestSha256: null,
          dataset: null,
        };
      }
      return {
        role,
        kind: 'CATALOGUE',
        datasetSlug: ref.datasetSlug,
        externalUrl: null,
        externalName: null,
        note: ref.note,
        manifestVersion: ref.manifestVersion,
        manifestSha256: ref.manifestSha256,
        dataset: known ? publicFacts(known) : null,
      };
    });

    // One line per task: the newest published result speaks for it.
    const evaluatedOn: ModelCardEvaluatedOn[] = [];
    const seenTasks = new Set<string>();
    for (const entry of published) {
      if (seenTasks.has(entry.taskSlug)) continue;
      seenTasks.add(entry.taskSlug);
      const known = facts.get(entry.datasetSlug);
      evaluatedOn.push({
        taskSlug: entry.taskSlug,
        taskName: entry.taskName,
        datasetSlug: entry.datasetSlug,
        datasetVersion: entry.datasetVersion,
        dataset: known ? publicFacts(known) : null,
      });
    }

    return toModelCardResponse(row, { datasetRefs, evaluatedOn });
  }

  /**
   * The rows to store for the declared datasets (#820).
   *
   * A catalogue dataset must be one the submitter can see: a slug that does
   * not exist and one they may not see get the same refusal, so the form
   * cannot be used to find out which private slugs exist. Its current version
   * and manifest hash are pinned, unless the card already named this dataset,
   * in which case the pin taken then is kept: editing a note must not move
   * the version the model was declared against.
   */
  private async datasetRefArgs(
    refs: ReadonlyArray<ModelCardDatasetRefInput>,
    user: CognitoAccessTokenPayload,
    existing: ModelCardWithRefs['datasetRefs'],
  ): Promise<DatasetRefArgs[]> {
    const slugs = refs.flatMap((r) => (r.datasetSlug ? [r.datasetSlug] : []));
    const facts = slugs.length > 0 ? await this.catalog.referenceFacts(slugs, user) : new Map();
    const pinned = new Map(
      existing.flatMap((r) => (r.datasetSlug ? [[r.datasetSlug, r] as const] : [])),
    );
    const missing = slugs.filter((s) => !facts.has(s) && !pinned.has(s));
    if (missing.length > 0) {
      const unknownDatasets = [...new Set(missing)];
      throw new BadRequestException({
        message:
          `Not in the catalogue, or not visible to you: ${unknownDatasets.join(', ')}. ` +
          'For a dataset held elsewhere, give its web address and its name.',
        // For the form, which points at the rows concerned (#820).
        unknownDatasets,
      });
    }
    return refs.map((ref) => {
      if (ref.datasetSlug === undefined) {
        return {
          role: ref.role,
          datasetSlug: null,
          manifestVersion: null,
          manifestSha256: null,
          externalUrl: ref.externalUrl ?? null,
          externalName: ref.externalName ?? null,
          note: ref.note ?? null,
        };
      }
      const before = pinned.get(ref.datasetSlug);
      const now: DatasetReferenceFacts | undefined = facts.get(ref.datasetSlug);
      return {
        role: ref.role,
        datasetSlug: ref.datasetSlug,
        manifestVersion: before ? before.manifestVersion : (now?.latestVersion ?? null),
        manifestSha256: before ? before.manifestSha256 : (now?.latestManifestSha256 ?? null),
        externalUrl: null,
        externalName: null,
        note: ref.note ?? null,
      };
    });
  }

  /**
   * Public model catalogue (#591, Y.3176 Discover). PUBLISHED cards only,
   * for every caller — the list is a discovery surface, not a workspace.
   */
  async listPublished(query: ListModelCardsQuery): Promise<ListModelCardsResponse> {
    const { rows, total } = await this.repo.searchPublished({
      q: query.q,
      modelClass: query.modelClass,
      jurisdiction: query.jurisdiction,
      sort: query.sort,
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
    return {
      items: rows,
      total,
      page: query.page,
      pageSize: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /**
   * An anonymous caller sees PUBLISHED cards only (#591). A PUBLISHED or
   * WITHDRAWN card is readable by anyone signed in: a card that was once
   * public stays on the record, with its status saying it was withdrawn.
   * DRAFT and SUBMITTED cards are readable only by the submitter and
   * reviewers. Everyone else gets the same 404 as a missing slug, so an
   * unpublished card's existence doesn't leak.
   */
  private async findVisible(
    slug: string,
    user?: CognitoAccessTokenPayload,
  ): Promise<ModelCardWithRefs> {
    const row = await this.repo.findBySlug(slug);
    // The rule is `modelCardVisibleTo` in @oci/shared-types, which the
    // evaluation module also applies before naming a linked card (#587).
    const visible =
      row !== null &&
      modelCardVisibleTo(row.status, {
        isSignedIn: user !== undefined,
        isSubmitter: user !== undefined && row.submitterUserId === cognitoSubAsUuid(user.sub),
        isReviewer: user !== undefined && isModelCardReviewer(user),
      });
    if (!row || !visible) throw new NotFoundException(`Model card '${slug}' not found`);
    return row;
  }
}

/** The catalogue's facts without the manifest hash, which only the pin needs. */
function publicFacts(facts: DatasetReferenceFacts): ModelCardDatasetFacts {
  return {
    name: facts.name,
    modalities: facts.modalities,
    formats: facts.formats,
    licence: facts.licence,
    latestVersion: facts.latestVersion,
  };
}

function isModelCardReviewer(user: CognitoAccessTokenPayload): boolean {
  return isModelCardReviewerGroups((user['cognito:groups'] ?? []) as string[]);
}

/** The fields an update names, for the audit payload: names only, never values. */
function changedFields(body: UpdateModelCardRequest): string[] {
  return Object.keys(body).sort();
}
