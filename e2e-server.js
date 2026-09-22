process.env.NODE_ENV = "test";
process.env.PORT = "5091";
process.env.JWT_ACCESS_SECRET = "e2e-access-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
process.env.JWT_REFRESH_SECRET = "e2e-refresh-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
process.env.CLIENT_URL = "http://localhost:3101";
process.env.BACKEND_URL = "http://localhost:5091";

const { MongoMemoryReplSet } = require("mongodb-memory-server");

(async () => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URI = mongod.getUri("e2e");

  const { connectDB } = require("./dist/config/db");
  await connectDB();

  const { registerOrganization } = require("./dist/services/auth.service");
  const { httpServer } = require("./dist/server");

  const admin = await registerOrganization({
    organizationName: "Acme E2E",
    name: "Ada Admin",
    email: "ada@e2e.test",
    password: "supersecret1",
  });

  const { userService } = require("./dist/services/user.service");
  const { Role } = require("./dist/models/Role.model");
  const role = await Role.create({ organizationId: admin.organizationId, name: "Member", permissions: [] });
  await userService.createUser({
    name: "Mona Member",
    email: "mona@e2e.test",
    password: "supersecret2",
    roleId: role._id.toString(),
    organizationId: admin.organizationId.toString(),
  });
  await userService.createUser({
    name: "Ben Builder",
    email: "ben@e2e.test",
    password: "supersecret2",
    roleId: role._id.toString(),
    organizationId: admin.organizationId.toString(),
  });

  httpServer.listen(5091, () => {
    console.log("E2E_READY", JSON.stringify({ port: 5091, admin: "ada@e2e.test", pass: "supersecret1" }));
  });
})().catch((e) => { console.error("E2E_SETUP_FAILED", e); process.exit(1); });
