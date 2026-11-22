-- Operator decisions on DICOM de-identification findings (#674, ADR-0026).
--
-- `dicom_finding_decisions`: who accepted findings of a dataset, when,
-- and why. `dicom_accepted_findings`: the (attribute, value digest)
-- pairs each decision accepts. Values are never stored: the digest is
-- the keyed one `dicom_findings` already holds. A stored file is
-- released when every one of its findings is accepted for its dataset.
--
-- That holds for findings with a value (a patient id, a date): accepted
-- for the dataset, they also cover the same value in a file uploaded
-- later. A finding about a file as a whole (a burned-in annotation
-- flag, private tags) says nothing about the content, so it is accepted
-- on the files an operator looked at and on no other: that is the new
-- nullable column `dicom_findings.accepted_decision_id`.
--
-- Additive: two tables, and one nullable column with its index on an
-- existing table. Nothing reads or writes them yet. They ship ahead of
-- the code that does, because a deploy rolls the API out before it runs
-- migrations.

-- CreateTable
CREATE TABLE "catalog"."dicom_finding_decisions" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_finding_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."dicom_accepted_findings" (
    "id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "attribute" TEXT NOT NULL,
    "value_digest" TEXT NOT NULL,

    CONSTRAINT "dicom_accepted_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dicom_finding_decisions_dataset_id_decided_at_idx" ON "catalog"."dicom_finding_decisions"("dataset_id", "decided_at");

-- CreateIndex
CREATE INDEX "dicom_accepted_findings_decision_id_idx" ON "catalog"."dicom_accepted_findings"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_accepted_findings_dataset_id_attribute_value_digest_key" ON "catalog"."dicom_accepted_findings"("dataset_id", "attribute", "value_digest");

-- AddForeignKey
ALTER TABLE "catalog"."dicom_finding_decisions" ADD CONSTRAINT "dicom_finding_decisions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "catalog"."datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."dicom_accepted_findings" ADD CONSTRAINT "dicom_accepted_findings_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "catalog"."dicom_finding_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "catalog"."dicom_findings" ADD COLUMN "accepted_decision_id" UUID;

-- CreateIndex
CREATE INDEX "dicom_findings_accepted_decision_id_idx" ON "catalog"."dicom_findings"("accepted_decision_id");

-- AddForeignKey
ALTER TABLE "catalog"."dicom_findings" ADD CONSTRAINT "dicom_findings_accepted_decision_id_fkey" FOREIGN KEY ("accepted_decision_id") REFERENCES "catalog"."dicom_finding_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
