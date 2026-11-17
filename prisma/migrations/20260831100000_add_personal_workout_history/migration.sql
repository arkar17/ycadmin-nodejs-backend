-- CreateTable
CREATE TABLE "PersonalWorkoutHistory" (
    "id" SERIAL NOT NULL,
    "calory" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "memberId" INTEGER NOT NULL,
    "workoutId" INTEGER NOT NULL,

    CONSTRAINT "PersonalWorkoutHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PersonalWorkoutHistory" ADD CONSTRAINT "PersonalWorkoutHistory_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalWorkoutHistory" ADD CONSTRAINT "PersonalWorkoutHistory_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
