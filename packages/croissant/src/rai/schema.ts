import { z } from 'zod';

/**
 * Croissant Responsible AI extension — 20 properties documenting
 * collection, annotation, demographics, biases, and limitations.
 *
 * Source:
 *   github.com/mlcommons/croissant/blob/main/docs/croissant-rai-spec.md
 *
 * All properties are OPTIONAL per the spec — RAI is supplementary to the
 * core dataset description. Health datasets in OCI are STRONGLY
 * encouraged (and may be policy-required at the host level — Phase B
 * decision) to fill in `dataCollection`, `dataCollectionTimeframe`,
 * `personalSensitiveInformation`, `dataBiases`, `dataLimitations`, and
 * any annotation-related fields.
 *
 * Properties are encoded against the **normalized** form (prefixes
 * stripped). Pre-norm inputs use `rai:dataCollection`, etc.
 */
export const RaiExtensionSchema = z
  .object({
    dataCollection: z.string().optional(),
    dataCollectionType: z.string().optional(),
    dataCollectionMissingData: z.string().optional(),
    dataCollectionRawData: z.string().optional(),
    dataCollectionTimeframe: z.string().optional(),

    dataImputationProtocol: z.string().optional(),
    dataManipulationProtocol: z.string().optional(),
    dataPreprocessingProtocol: z.string().optional(),

    dataAnnotationProtocol: z.string().optional(),
    dataAnnotationPlatform: z.string().optional(),
    dataAnnotationAnalysis: z.string().optional(),

    dataReleaseMaintenancePlan: z.string().optional(),

    personalSensitiveInformation: z.string().optional(),
    dataSocialImpact: z.string().optional(),
    dataBiases: z.string().optional(),
    dataLimitations: z.string().optional(),
    dataUseCases: z.string().optional(),

    annotationsPerItem: z.string().optional(),
    annotatorDemographics: z.string().optional(),
    machineAnnotationTools: z.string().optional(),
  })
  .passthrough();

export type RaiExtension = z.infer<typeof RaiExtensionSchema>;

/**
 * Heuristic: a manifest "uses RAI" when at least one rai: property is set.
 * The validator surfaces this in `ValidationResult.hasRai` so callers can
 * gate behaviour ("regulator-grade datasets must include RAI").
 */
export const RAI_PROPERTIES = [
  'dataCollection',
  'dataCollectionType',
  'dataCollectionMissingData',
  'dataCollectionRawData',
  'dataCollectionTimeframe',
  'dataImputationProtocol',
  'dataManipulationProtocol',
  'dataPreprocessingProtocol',
  'dataAnnotationProtocol',
  'dataAnnotationPlatform',
  'dataAnnotationAnalysis',
  'dataReleaseMaintenancePlan',
  'personalSensitiveInformation',
  'dataSocialImpact',
  'dataBiases',
  'dataLimitations',
  'dataUseCases',
  'annotationsPerItem',
  'annotatorDemographics',
  'machineAnnotationTools',
] as const;
