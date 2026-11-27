import type { ToolsetFormField, ToolsetFormValues } from '../../lib/toolset-form';

/**
 * What the declare and edit actions return to the toolset form (#830). On an
 * error the values come back as typed, so the form shows them again.
 */
export type ToolsetFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<ToolsetFormField, string>;
      /** Messages no single field owns. */
      otherErrors?: ReadonlyArray<string>;
      values?: ToolsetFormValues;
      attempt: number;
    };

export type ToolsetLifecycleState = { status: 'idle' } | { status: 'error'; message: string };
