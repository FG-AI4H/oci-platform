import { z } from 'zod';

/**
 * Croissant 1.0 base schema (MLCommons, March 2024).
 *
 * Encoded against the **normalized** form (prefixes stripped — see
 * validator/normalize.ts). Schemas use bare keys like `name` rather than
 * `sc:name`, and recognise both forms at the input boundary.
 *
 * `dct:conformsTo` is one of the few keys where the prefix-stripped form
 * (`conformsTo`) is what we match against; the validator pulls the
 * conformance IRI from the value side.
 *
 * This schema is intentionally **permissive** on properties beyond the
 * core required set — Croissant grows over time, RAI/BIOCroissant inject
 * fields, and `@context` may bring in arbitrary vocabularies. We pass
 * unknown keys through (`.passthrough()`) and let the layered RAI /
 * BIOCroissant schemas tighten what they care about.
 *
 * Required-vs-recommended: per-spec at
 *   https://docs.mlcommons.org/croissant/docs/croissant-spec.html
 * we treat 1.0's required set (`name`, `description`, `license`, `url`,
 * `creator`, `datePublished`, plus `@context`/`@type`/`conformsTo`) as
 * Zod-required. Recommended fields are .optional().
 */

const Url = z.string().min(1);
const NonEmptyString = z.string().min(1);

const Reference = z.union([NonEmptyString, z.object({ '@id': NonEmptyString }).passthrough()]);

const PersonOrOrg = z.union([
  NonEmptyString,
  z
    .object({
      '@type': z
        .union([
          z.literal('sc:Person'),
          z.literal('sc:Organization'),
          z.literal('Person'),
          z.literal('Organization'),
        ])
        .optional(),
      name: NonEmptyString.optional(),
      url: Url.optional(),
      email: z.string().optional(),
    })
    .passthrough(),
]);

const License = z.union([
  NonEmptyString,
  z.object({ '@type': z.string().optional(), name: z.string().optional() }).passthrough(),
]);

const FileObject = z
  .object({
    '@type': z.union([z.literal('sc:FileObject'), z.literal('FileObject')]),
    '@id': NonEmptyString,
    name: NonEmptyString,
    contentUrl: Url.optional(),
    contentSize: z.string().optional(),
    encodingFormat: z.string().optional(),
    sha256: z.string().optional(),
    sameAs: z.union([Url, z.array(Url)]).optional(),
    containedIn: z.union([Reference, z.array(Reference)]).optional(),
  })
  .passthrough();

const FileSet = z
  .object({
    '@type': z.union([z.literal('sc:FileSet'), z.literal('FileSet')]),
    '@id': NonEmptyString,
    containedIn: z.union([Reference, z.array(Reference)]).optional(),
    includes: z.union([NonEmptyString, z.array(NonEmptyString)]).optional(),
    excludes: z.union([NonEmptyString, z.array(NonEmptyString)]).optional(),
    encodingFormat: z.string().optional(),
  })
  .passthrough();

const Distribution = z.union([FileObject, FileSet]);

const DataSource = z
  .object({
    fileObject: Reference.optional(),
    fileSet: Reference.optional(),
    recordSet: Reference.optional(),
    extract: z
      .object({
        fileProperty: z
          .enum(['fullpath', 'filename', 'content', 'lines', 'lineNumbers'])
          .optional(),
        column: z.string().optional(),
        jsonPath: z.string().optional(),
      })
      .passthrough()
      .optional(),
    transform: z
      .object({
        delimiter: z.string().optional(),
        regex: z.string().optional(),
        jsonQuery: z.string().optional(),
      })
      .passthrough()
      .optional(),
    format: z.string().optional(),
  })
  .passthrough();

const Field = z
  .object({
    '@type': z.union([z.literal('cr:Field'), z.literal('Field')]),
    '@id': NonEmptyString,
    name: NonEmptyString.optional(),
    description: z.string().optional(),
    dataType: z.union([NonEmptyString, z.array(NonEmptyString)]).optional(),
    source: z.union([Url, DataSource]).optional(),
    repeated: z.boolean().optional(),
    references: z.union([Reference, z.array(Reference)]).optional(),
  })
  .passthrough();

const RecordSet = z
  .object({
    '@type': z.union([z.literal('cr:RecordSet'), z.literal('RecordSet')]),
    '@id': NonEmptyString,
    name: NonEmptyString.optional(),
    description: z.string().optional(),
    field: z.array(Field).optional(),
    key: z.union([NonEmptyString, z.array(NonEmptyString)]).optional(),
    dataType: z.union([NonEmptyString, z.array(NonEmptyString)]).optional(),
  })
  .passthrough();

export const Croissant10Schema = z
  .object({
    '@context': z.union([NonEmptyString, z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    '@type': z.union([z.literal('sc:Dataset'), z.literal('Dataset')]),
    /** `dct:conformsTo` — at this layer must point at one of the supported Croissant IRIs. */
    conformsTo: z.union([
      z.literal('http://mlcommons.org/croissant/1.0'),
      z.literal('http://mlcommons.org/croissant/1.1'),
    ]),

    // Required by 1.0 spec
    name: NonEmptyString,
    description: NonEmptyString,
    license: z.union([License, z.array(License)]),
    url: Url,
    creator: z.union([PersonOrOrg, z.array(PersonOrOrg)]),
    datePublished: NonEmptyString, // ISO 8601 date or date-time

    // Recommended
    keywords: z
      .union([NonEmptyString, z.array(z.union([NonEmptyString, z.object({}).passthrough()]))])
      .optional(),
    publisher: z.union([PersonOrOrg, z.array(PersonOrOrg)]).optional(),
    version: z.union([NonEmptyString, z.number()]).optional(),
    dateCreated: NonEmptyString.optional(),
    dateModified: NonEmptyString.optional(),
    sameAs: z.union([Url, z.array(Url)]).optional(),
    sdLicense: License.optional(),
    inLanguage: z.union([NonEmptyString, z.array(NonEmptyString)]).optional(),
    citeAs: z.string().optional(),
    isLiveDataset: z.boolean().optional(),
    distribution: z.array(Distribution).optional(),
    recordSet: z.array(RecordSet).optional(),
  })
  .passthrough();

export type Croissant10 = z.infer<typeof Croissant10Schema>;
