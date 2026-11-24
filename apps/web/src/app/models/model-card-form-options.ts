import { getTranslations } from 'next-intl/server';
import {
  ClinicalPathwaySchema,
  IntendedUserRoleSchema,
  MedicalPurposeSchema,
  OperatingEnvironmentSchema,
  RegulatoryApprovalSchema,
} from '@oci/shared-types';
import { MODEL_CLASS_OPTIONS } from '../../lib/model-card-labels';
import type { ModelCardFormOptions } from './model-card-form';

/**
 * The enum options of the model-card form (#651), labelled in the interface
 * language with the `Models` messages the catalogue already uses, so a value
 * reads the same on the form as on the card. Built on the server so the
 * `Models` namespace does not travel to the browser.
 */
export async function modelCardFormOptions(): Promise<ModelCardFormOptions> {
  const t = await getTranslations('Models');
  return {
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
