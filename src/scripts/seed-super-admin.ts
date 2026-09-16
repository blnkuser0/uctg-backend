import mongoose from "mongoose";
import { config } from "../config";
import { provisionSuperAdmin } from "../services/platform.service";

async function seed(): Promise<void> {
  await mongoose.connect(config.mongo.uri);
  const admin = await provisionSuperAdmin({
    name: "Ugnexa Super Admin",
    email: "admin@test.com",
    password: "AdminTest123!",
  });
  process.stdout.write(`Super Admin ready: ${admin.email}\n`);
}

seed()
  .catch((error) => {
    console.error("Failed to seed Super Admin", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
