/**
 * BIOCroissant — Healthcare extension to MLCommons Croissant.
 *
 * WG-Data deliverable mapping:
 * - DAP 2026-Q2: Healthcare Croissant Extension v1.0 ingestion (Phase B)
 * - DAP 2027-Q1: Ontology compatibility layer (Phase E)
 *
 * Spec status: draft. Real schema is published by MLCommons + WG-Data.
 * This package provides:
 *   - Type-safe parsing (Zod)
 *   - JSON Schema validation (Ajv)
 *   - Healthcare-specific extension fields (consent, provenance, FHIR refs)
 *
 * See docs/architecture.md and docs/links.md for upstream references.
 */

import { z } from 'zod';

export const CroissantManifestSchema = z.object({
  '@context': z.union([z.string(), z.array(z.string())]).optional(),
  '@type': z.literal('sc:Dataset').optional(),
  name: z.string(),
  description: z.string().optional(),
  url: z.string().url().optional(),
  // Placeholder — Phase B will mirror the published schema
  recordSet: z.array(z.unknown()).optional(),
  fileObject: z.array(z.unknown()).optional(),
  fileSet: z.array(z.unknown()).optional(),
  // BIOCroissant healthcare extensions
  bioCroissant: z
    .object({
      consentBasis: z.string().optional(),
      ontologies: z.array(z.string()).optional(),
      modality: z
        .enum(['imaging', 'genomics', 'ehr', 'clinicalNotes', 'audio', 'video', 'tabular'])
        .optional(),
      jurisdiction: z.string().optional(),
    })
    .optional(),
});
export type CroissantManifest = z.infer<typeof CroissantManifestSchema>;

export function parseManifest(raw: unknown): CroissantManifest {
  return CroissantManifestSchema.parse(raw);
}
