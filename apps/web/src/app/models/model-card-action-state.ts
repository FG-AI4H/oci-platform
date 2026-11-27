import type { ModelCardFormField, ModelCardFormValues } from '../../lib/model-card-form';

/**
 * What the create and edit actions return to the model-card form (#651).
 * On an error the values come back as typed, so the form shows them again.
 * `attempt` changes with every answer, so the form can tell two errors with
 * the same text apart and open the step that needs attention each time.
 */
export type ModelCardFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<ModelCardFormField, string>;
      /** Messages about one dataset row, by row (#820). */
      datasetRefErrors?: ReadonlyMap<number, string>;
      /** Messages no single field owns. */
      otherErrors?: ReadonlyArray<string>;
      values?: ModelCardFormValues;
      attempt: number;
    };
