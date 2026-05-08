-- CreateTable
CREATE TABLE "identity"."user_preferences" (
    "user_id" UUID NOT NULL,
    "dark_mode" TEXT NOT NULL DEFAULT 'system',
    "locale" TEXT,
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);
