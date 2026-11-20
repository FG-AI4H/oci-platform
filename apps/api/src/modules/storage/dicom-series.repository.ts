import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import {
  listSeriesInstances,
  listSeriesSummaries,
  type SeriesInstanceRow,
  type SeriesScope,
  type SeriesSummaryRow,
} from './repositories/dicom-series.raw.js';

export type { SeriesInstanceRow, SeriesScope, SeriesSummaryRow };

/** Read side of the DICOM series index (ADR-0026). */
@Injectable()
export class DicomSeriesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The series row and the dataset it belongs to, or null. */
  async findSeries(
    id: string,
  ): Promise<{ id: string; datasetId: string; seriesInstanceUid: string; slug: string } | null> {
    const row = (await this.prisma.client.dicomSeries.findUnique({
      where: { id },
      select: {
        id: true,
        datasetId: true,
        seriesInstanceUid: true,
        dataset: { select: { slug: true } },
      },
    })) as {
      id: string;
      datasetId: string;
      seriesInstanceUid: string;
      dataset: { slug: string };
    } | null;
    if (!row) return null;
    return {
      id: row.id,
      datasetId: row.datasetId,
      seriesInstanceUid: row.seriesInstanceUid,
      slug: row.dataset.slug,
    };
  }

  /**
   * The named version of a dataset, or its latest one when no version
   * is named. "Latest" is the most recently published, the same one an
   * upload attaches to and the whole-dataset archive is built from.
   */
  async findVersion(
    datasetId: string,
    version: string | undefined,
  ): Promise<{ id: string; version: string } | null> {
    return (await this.prisma.client.datasetVersion.findFirst({
      where: { datasetId, ...(version === undefined ? {} : { version }) },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, version: true },
    })) as { id: string; version: string } | null;
  }

  listSeries(scope: SeriesScope & { limit: number }): Promise<SeriesSummaryRow[]> {
    return listSeriesSummaries(this.prisma.client, scope);
  }

  listInstances(scope: SeriesScope & { seriesInstanceUid: string }): Promise<SeriesInstanceRow[]> {
    return listSeriesInstances(this.prisma.client, scope);
  }
}
