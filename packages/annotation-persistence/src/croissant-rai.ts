import { type AnnotationRecord, type CroissantRaiEntry } from './types.js';

/**
 * Croissant-RAI derivation (ADR-0008 / ADR-0002): the accepted
 * annotation becomes a `cr:FileObject` distribution entry with an
 * `rai:annotation` provenance block, appended to the catalog dataset's
 * Croissant 1.1 manifest as a new annotation distribution.
 */
export function toCroissantRaiEntry(record: AnnotationRecord): CroissantRaiEntry {
  const { provenance: p } = record;
  return {
    '@type': 'cr:FileObject',
    '@id': `annotation/${record.annotationId}`,
    name: `annotation-${record.annotationId}`,
    description: `${record.payload.kind} annotation on ${record.sampleRef} (${record.modality})`,
    encodingFormat: 'application/json',
    'rai:annotation': {
      annotationId: record.annotationId,
      annotationType: record.payload.kind,
      modality: record.modality,
      sampleRef: record.sampleRef,
      tool: { id: p.toolIntegrationId, version: p.toolVersion },
      schemaProfile: p.schemaProfile,
      createdAt: p.createdAt,
      annotatorSub: p.annotatorSub,
      ...(p.metadataExposureProfile
        ? { metadataExposureConfigHash: p.metadataExposureProfile.visibilityConfigHash }
        : {}),
      ...(p.hashChain ? { contentHash: p.hashChain.sha256 } : {}),
    },
  };
}
