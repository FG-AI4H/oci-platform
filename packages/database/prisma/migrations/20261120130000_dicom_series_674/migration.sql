-- DICOM series, as rows of their own (#674, ADR-0026).
--
-- A series gets an id of the platform's own, so that the read endpoint
-- for one series, and later an annotation task, can point at it without
-- a DICOM UID in a URL. One row per (dataset, SeriesInstanceUID). Which
-- instances belong to it is read from `dicom_objects` through the
-- distributions of a dataset version.
--
-- Additive: one table, nothing existing is altered. Nothing writes to it
-- yet. It ships ahead of the code that does, because a deploy rolls the
-- API out before it runs migrations: code and table in one deploy would
-- have uploads writing to a table that is not there yet.

-- CreateTable
CREATE TABLE "catalog"."dicom_series" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "series_instance_uid" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dicom_series_dataset_id_series_instance_uid_key" ON "catalog"."dicom_series"("dataset_id", "series_instance_uid");

-- AddForeignKey
ALTER TABLE "catalog"."dicom_series" ADD CONSTRAINT "dicom_series_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "catalog"."datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
