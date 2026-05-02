import { z } from 'zod';

// ==== Identity ============================================================

export const RoleSchema = z.enum([
  'admin',
  'host',
  'participant',
  'annotator',
  'reviewer',
  'supervisor',
  'regulator',
]);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  cognitoId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  roles: z.array(RoleSchema),
});
export type User = z.infer<typeof UserSchema>;

// ==== Catalog (DAP) =======================================================

export const DatasetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  croissant: z.unknown().optional(),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const tokens = {
  /** Phase B will add: Campaign, Task, Sample, Annotation, AnnotationTool */
  /** Phase C will add: Challenge, Submission, Phase, Leaderboard */
  /** Phase D will add: Report, ReportTemplate, AuditEvent */
  /** Phase E will add: DMXP transaction envelope, FederatedConnector */
};
