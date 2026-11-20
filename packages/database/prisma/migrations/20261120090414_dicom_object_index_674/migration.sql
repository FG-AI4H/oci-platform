-- DICOM series index and de-identification hold (#674, ADR-0026).
--
-- One row per stored file the platform recognised as DICOM, keyed by
-- where the bytes live, not by distribution: a new dataset version
-- adopts the stored files of the previous one, so the index and the
-- hold have to follow the file. Built from the header only.
--
-- `dicom_findings` holds a keyed digest of each populated identifying
-- attribute, never the value.
--
-- Additive: two enums and two tables, nothing existing is altered. A
-- stored file with no row here is treated as before.

-- CreateEnum
CREATE TYPE "catalog"."DicomCheckStatus" AS ENUM ('CLEAR', 'HELD', 'RELEASED', 'UNREADABLE');

-- CreateEnum
CREATE TYPE "catalog"."DicomObjectKind" AS ENUM ('SINGLE_FRAME_IMAGE', 'MULTI_FRAME_IMAGE', 'OTHER');

-- CreateTable
CREATE TABLE "catalog"."dicom_objects" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "s3_bucket" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "check_status" "catalog"."DicomCheckStatus" NOT NULL,
    "unreadable_reason" TEXT,
    "object_kind" "catalog"."DicomObjectKind",
    "sop_class_uid" TEXT,
    "sop_instance_uid" TEXT,
    "study_instance_uid" TEXT,
    "series_instance_uid" TEXT,
    "frame_of_reference_uid" TEXT,
    "transfer_syntax_uid" TEXT,
    "modality" TEXT,
    "series_number" INTEGER,
    "instance_number" INTEGER,
    "image_position_patient" DOUBLE PRECISION[],
    "image_orientation_patient" DOUBLE PRECISION[],
    "rows" INTEGER,
    "columns" INTEGER,
    "number_of_frames" INTEGER,
    "bits_allocated" INTEGER,
    "pixel_representation" INTEGER,
    "photometric_interpretation" TEXT,
    "slice_thickness" DOUBLE PRECISION,
    "pixel_spacing" DOUBLE PRECISION[],
    "window_center" DOUBLE PRECISION,
    "window_width" DOUBLE PRECISION,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."dicom_findings" (
    "id" UUID NOT NULL,
    "dicom_object_id" UUID NOT NULL,
    "attribute" TEXT NOT NULL,
    "value_digest" TEXT NOT NULL,

    CONSTRAINT "dicom_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dicom_objects_dataset_id_series_instance_uid_idx" ON "catalog"."dicom_objects"("dataset_id", "series_instance_uid");

-- CreateIndex
CREATE INDEX "dicom_objects_dataset_id_check_status_idx" ON "catalog"."dicom_objects"("dataset_id", "check_status");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_objects_s3_bucket_s3_key_key" ON "catalog"."dicom_objects"("s3_bucket", "s3_key");

-- CreateIndex
CREATE INDEX "dicom_findings_attribute_value_digest_idx" ON "catalog"."dicom_findings"("attribute", "value_digest");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_findings_dicom_object_id_attribute_value_digest_key" ON "catalog"."dicom_findings"("dicom_object_id", "attribute", "value_digest");

-- AddForeignKey
ALTER TABLE "catalog"."dicom_objects" ADD CONSTRAINT "dicom_objects_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "catalog"."datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."dicom_findings" ADD CONSTRAINT "dicom_findings_dicom_object_id_fkey" FOREIGN KEY ("dicom_object_id") REFERENCES "catalog"."dicom_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
