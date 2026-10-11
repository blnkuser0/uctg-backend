import mongoose from "mongoose";
import { migrateAccomplishmentSections } from "../src/scripts/migrate-accomplishment-sections";
import { Accomplishment } from "../src/models/Accomplishment.model";

describe("Accomplishment sections migration", () => {
  it("moves the old text field into accomplishment, leaving blockers/inProgress blank", async () => {
    const organizationId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    // Bypass the current schema (which no longer declares `text`) to simulate a pre-migration
    // document exactly as it would look in a real, not-yet-migrated production database.
    await Accomplishment.collection.insertOne({
      organizationId,
      userId,
      date: "2025-06-01",
      text: "Shipped the old feature",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { migrated } = await migrateAccomplishmentSections();
    expect(migrated).toBe(1);

    const entry = await Accomplishment.findOne({ organizationId, userId });
    expect(entry!.accomplishment).toBe("Shipped the old feature");
    expect(entry!.blockers).toBe("");
    expect(entry!.inProgress).toBe("");
    expect((entry!.toObject() as { text?: string }).text).toBeUndefined();
  });

  it("is idempotent: running it twice does not touch already-migrated documents", async () => {
    const organizationId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    await Accomplishment.create({ organizationId, userId, date: "2025-06-02", accomplishment: "Already migrated" });

    const first = await migrateAccomplishmentSections();
    expect(first.migrated).toBe(0);
    const second = await migrateAccomplishmentSections();
    expect(second.migrated).toBe(0);

    const entry = await Accomplishment.findOne({ organizationId, userId });
    expect(entry!.accomplishment).toBe("Already migrated");
  });
});
