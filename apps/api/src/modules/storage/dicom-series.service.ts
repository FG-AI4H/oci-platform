import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { orderInstances, type DicomInstanceHeader } from '@oci/dicom';
import {
  dicomSeriesSampleRef,
  parseDicomSeriesSampleRef,
  type DatasetSlug,
  type DicomSeriesDetail,
  type DicomSeriesInstance,
  type DicomSeriesList,
  type DicomSeriesSample,
  type DicomSeriesTaskCandidate,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CatalogService } from '../catalog/catalog.service.js';
import { DicomSeriesRepository, type SeriesInstanceRow } from './dicom-series.repository.js';
import { StorageService } from './storage.service.js';

const SERIES_NOT_FOUND = 'series not found';
const SAMPLE_NOT_FOUND = 'sample not found';

/** More series than any campaign makes tasks of; past it, creation is refused, never cut short. */
const MAX_TASK_SAMPLES = 5000;

/** The list is for a page, not an export. `total` says how many there are. */
const MAX_SERIES_LISTED = 500;

/** A fixed-length numeric attribute, or null when the header had none. */
function tuple<N extends number>(
  values: number[] | null,
  length: N,
): (number[] & { length: N }) | null {
  return values !== null && values.length === length ? (values as number[] & { length: N }) : null;
}

/**
 * The two DICOM series read endpoints (ADR-0026).
 *
 * Both hand out the same thing a download does, so both go through the
 * same gate, `StorageService.authoriseDatasetBytes`:
 *
 *   - PRIVATE     the host or an admin
 *   - RESTRICTED  the host, an admin, or an approved access request
 *   - PUBLIC      anyone, signed in or not
 *
 * and both apply the hold: a file with undecided de-identification
 * findings reaches its host and platform operators only. For everyone
 * else it is absent, from the counts as well as from the list, and a
 * series made only of such files does not exist.
 *
 * A series is made of single-frame images (ADR-0026). Left out for
 * every caller: other DICOM objects, files whose header could not be
 * read (they have no series), and files that are individually
 * access-gated (`requiresAccess`), as in the whole-dataset archive.
 *
 * The annotation and arbitration screens deliver the same addresses
 * under their own rule, through `listTaskSamples` and `taskSample`
 * below. `getSeries` always applies the dataset's rule.
 */
@Injectable()
export class DicomSeriesService {
  constructor(
    @Inject(DicomSeriesRepository) private readonly repo: DicomSeriesRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  /** The series of one version of a dataset. */
  async listForDataset(args: {
    slug: DatasetSlug;
    version: string | undefined;
    user: CognitoAccessTokenPayload | undefined;
  }): Promise<DicomSeriesList> {
    const owner = await this.catalog.findOwnerBySlug(args.slug);
    if (!owner) throw new NotFoundException(`dataset "${args.slug}" not found`);

    // Authorise before reading anything about the contents.
    const dataset = await this.storage.authoriseDatasetBytes({
      datasetId: owner.id,
      requiresAccess: false,
      user: args.user,
    });
    const version = await this.requireVersion(owner.id, args.version);

    const rows = await this.repo.listSeries({
      datasetId: owner.id,
      versionId: version.id,
      includeHeld: this.storage.isHostOrOperator(dataset.hostId, args.user),
      limit: MAX_SERIES_LISTED,
    });

    return {
      datasetSlug: args.slug,
      version: version.version,
      total: rows[0]?.total ?? 0,
      series: rows.map((row) => ({
        id: row.id,
        studyInstanceUid: row.study_instance_uid,
        seriesInstanceUid: row.series_instance_uid,
        modality: row.modality,
        seriesNumber: row.series_number,
        instanceCount: row.instance_count,
        heldInstanceCount: row.held_instance_count,
        rows: row.rows,
        columns: row.columns,
      })),
    };
  }

  /**
   * One series: its instances in display order, each with a signed
   * storage address the browser fetches the file from directly.
   */
  async getSeries(args: {
    seriesId: string;
    version: string | undefined;
    user: CognitoAccessTokenPayload | undefined;
  }): Promise<DicomSeriesDetail> {
    const series = await this.repo.findSeries(args.seriesId);
    if (!series) throw new NotFoundException(SERIES_NOT_FOUND);

    const dataset = await this.storage.authoriseDatasetBytes({
      datasetId: series.datasetId,
      requiresAccess: false,
      user: args.user,
    });
    // One answer for "no such version" and "nothing to open": a
    // different message here would tell a caller who may not see a
    // held series that its id is real.
    const version = await this.repo.findVersion(series.datasetId, args.version);
    if (!version) throw new NotFoundException(SERIES_NOT_FOUND);

    const rows = await this.repo.listInstances({
      datasetId: series.datasetId,
      versionId: version.id,
      includeHeld: this.storage.isHostOrOperator(dataset.hostId, args.user),
      seriesInstanceUid: series.seriesInstanceUid,
    });
    // Nothing this caller may open: the series is not in this version,
    // or every file of it is held. The same answer as an unknown id, so
    // that a held series is not confirmed to exist.
    if (rows.length === 0) throw new NotFoundException(SERIES_NOT_FOUND);

    const ordered = this.inStackOrder(rows);

    // Taken before signing, so that every address lasts at least as
    // long as stated.
    const expiresAt = (await this.storage.signedUrlValidUntil()).toISOString();
    const instances = await Promise.all(ordered.map((row) => this.toInstance(row)));

    const first = ordered[0];
    const same = (pick: (row: SeriesInstanceRow) => number | null): number | null => {
      const value = first ? pick(first) : null;
      return ordered.every((row) => pick(row) === value) ? value : null;
    };

    return {
      id: series.id,
      datasetSlug: series.slug,
      version: version.version,
      studyInstanceUid: first?.study_instance_uid ?? null,
      seriesInstanceUid: series.seriesInstanceUid,
      frameOfReferenceUid: first?.frame_of_reference_uid ?? null,
      modality: first?.modality ?? null,
      seriesNumber: first?.series_number ?? null,
      instanceCount: instances.length,
      heldInstanceCount: instances.filter((instance) => instance.held).length,
      rows: same((row) => row.rows),
      columns: same((row) => row.columns),
      expiresAt,
      instances,
    };
  }

  // ==== As the sample of an annotation task (#646) ========================
  //
  // No access rule here, on purpose. A reader usually has no access to
  // the dataset itself; the annotation module delivers a task's sample
  // under its own rule (the assignee, the campaign's supervisors and
  // managers, the task's arbiter) and calls these after applying it.
  // What stays here is what no rule may lift: a held file never reaches
  // a task, whoever asks.

  /**
   * The series of the campaign's pinned version that tasks can be made
   * of, held images counted. Task creation refuses a series that has
   * any.
   */
  async listTaskSamples(versionId: string): Promise<DicomSeriesTaskCandidate[]> {
    const version = await this.repo.findVersionById(versionId);
    if (!version) throw new NotFoundException('dataset version not found');
    const rows = await this.repo.listSeries({
      datasetId: version.datasetId,
      versionId,
      includeHeld: true,
      limit: MAX_TASK_SAMPLES,
    });
    if ((rows[0]?.total ?? 0) > MAX_TASK_SAMPLES) {
      throw new ConflictException(
        `the version has more than ${MAX_TASK_SAMPLES} series; split the campaign`,
      );
    }
    return rows.map((row) => ({
      sampleRef: dicomSeriesSampleRef(row.id),
      seriesId: row.id,
      modality: row.modality,
      seriesNumber: row.series_number,
      imageCount: row.instance_count,
      heldImageCount: row.held_instance_count,
    }));
  }

  /**
   * The sample of a task on a DICOM series: its images in display
   * order, each with a fresh signed address, read in the campaign's
   * pinned version. 404 when the reference is not a series of that
   * version; 409 when any of its files is held, which happens when a
   * file is held after the task was made.
   */
  async taskSample(args: { sampleRef: string; versionId: string }): Promise<DicomSeriesSample> {
    const seriesId = parseDicomSeriesSampleRef(args.sampleRef);
    if (seriesId === null) throw new NotFoundException(SAMPLE_NOT_FOUND);
    const [series, version] = await Promise.all([
      this.repo.findSeries(seriesId),
      this.repo.findVersionById(args.versionId),
    ]);
    if (!series || !version || series.datasetId !== version.datasetId) {
      throw new NotFoundException(SAMPLE_NOT_FOUND);
    }

    const rows = await this.repo.listInstances({
      datasetId: series.datasetId,
      versionId: version.id,
      includeHeld: true,
      seriesInstanceUid: series.seriesInstanceUid,
    });
    if (rows.length === 0) throw new NotFoundException(SAMPLE_NOT_FOUND);
    if (rows.some((row) => row.held)) {
      throw new ConflictException(
        'a file of this sample is held for de-identification findings; an operator has to decide on it first',
      );
    }

    const ordered = this.inStackOrder(rows);
    const expiresAt = (await this.storage.signedUrlValidUntil()).toISOString();
    const instances = await Promise.all(ordered.map((row) => this.toInstance(row)));
    return {
      kind: 'dicom-series',
      modality: ordered[0]?.modality ?? null,
      expiresAt,
      instances,
    };
  }

  /** Along the stack, in the scanner's own direction (ADR-0026). */
  private inStackOrder(rows: SeriesInstanceRow[]): SeriesInstanceRow[] {
    return orderInstances(
      rows.map((row) => ({
        row,
        sopInstanceUid: row.sop_instance_uid,
        instanceNumber: row.instance_number,
        imagePositionPatient: tuple(
          row.image_position_patient,
          3,
        ) as DicomInstanceHeader['imagePositionPatient'],
        imageOrientationPatient: tuple(
          row.image_orientation_patient,
          6,
        ) as DicomInstanceHeader['imageOrientationPatient'],
      })),
    ).map((entry) => entry.row);
  }

  private async requireVersion(
    datasetId: string,
    version: string | undefined,
  ): Promise<{ id: string; version: string }> {
    const found = await this.repo.findVersion(datasetId, version);
    if (!found) {
      throw new NotFoundException(
        version === undefined
          ? 'the dataset has no published version yet'
          : `the dataset has no version "${version}"`,
      );
    }
    return found;
  }

  private async toInstance(row: SeriesInstanceRow): Promise<DicomSeriesInstance> {
    return {
      distributionId: row.distribution_id,
      url: await this.storage.signStoredObjectUrl(row.s3_bucket, row.s3_key),
      held: row.held,
      sopInstanceUid: row.sop_instance_uid,
      sopClassUid: row.sop_class_uid,
      transferSyntaxUid: row.transfer_syntax_uid,
      instanceNumber: row.instance_number,
      rows: row.rows,
      columns: row.columns,
      bitsAllocated: row.bits_allocated,
      pixelRepresentation: row.pixel_representation,
      photometricInterpretation: row.photometric_interpretation,
      imagePositionPatient: tuple(row.image_position_patient, 3),
      imageOrientationPatient: tuple(row.image_orientation_patient, 6),
      pixelSpacing: tuple(row.pixel_spacing, 2),
      sliceThickness: row.slice_thickness,
      windowCenter: row.window_center,
      windowWidth: row.window_width,
    };
  }
}
