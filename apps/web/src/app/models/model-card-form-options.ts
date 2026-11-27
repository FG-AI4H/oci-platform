import { getTranslations } from 'next-intl/server';
import type { Session } from 'next-auth';
import {
  ClinicalPathwaySchema,
  IntendedUserRoleSchema,
  MedicalPurposeSchema,
  ModelCardDatasetRoleSchema,
  OperatingEnvironmentSchema,
  RegulatoryApprovalSchema,
  type ListDatasetsResponse,
} from '@oci/shared-types';
import { apiFetch } from '../../lib/api';
import { MODEL_CLASS_OPTIONS } from '../../lib/model-card-labels';
import type { ModelCardFormOptions } from './model-card-form';

/**
 * The enum options of the model-card form (#651), labelled in the interface
 * language with the `Models` messages the catalogue already uses, so a value
 * reads the same on the form as on the card. Built on the server so the
 * `Models` namespace does not travel to the browser.
 */
export async function modelCardFormOptions(session: Session | null): Promise<ModelCardFormOptions> {
  const [t, datasets] = await Promise.all([getTranslations('Models'), visibleDatasets(session)]);
  return {
    datasetRole: ModelCardDatasetRoleSchema.options.map((v) => ({
      value: v,
      label: t(`datasetRole.${v}`),
    })),
    datasets,
    modelClass: MODEL_CLASS_OPTIONS.map((o) => ({
      value: o.value,
      label: t(`modelClass.${o.value}`),
    })),
    medicalPurpose: MedicalPurposeSchema.options.map((v) => ({
      value: v,
      label: t(`medicalPurpose.${v}`),
    })),
    clinicalPathway: ClinicalPathwaySchema.options.map((v) => ({
      value: v,
      label: t(`clinicalPathway.${v}`),
    })),
    operatingEnvironment: OperatingEnvironmentSchema.options.map((v) => ({
      value: v,
      label: t(`operatingEnvironment.${v}`),
    })),
    intendedUser: IntendedUserRoleSchema.options.map((v) => ({
      value: v,
      label: t(`intendedUser.${v}`),
    })),
    regulatoryStatus: RegulatoryApprovalSchema.shape.status.options.map((v) => ({
      value: v,
      label: t(`regulatoryStatus.${v}`),
    })),
  };
}

/**
 * The published datasets this user may see, as suggestions for the dataset
 * rows (#820): identifier and name. Suggestions only: the API decides what a
 * card may name, and the form works without them, so a failed read gives none.
 */
async function visibleDatasets(session: Session | null): Promise<ModelCardFormOptions['datasets']> {
  try {
    const page = await apiFetch<ListDatasetsResponse>(
      '/v2/catalog/datasets?status=PUBLISHED&limit=100',
      { session, revalidate: 0 },
    );
    return (page?.items ?? []).map((d) => ({ value: d.slug, label: d.name }));
  } catch {
    return [];
  }
}
