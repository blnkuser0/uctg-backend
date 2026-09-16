import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/superAdmin.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createOrgSchema, createPlatformUserSchema, assignDeveloperSchema } from "../validations/platform.validation";
import * as platformController from "../controllers/platform.controller";

const router = Router();

router.use(auth(), requireSuperAdmin());

router.post("/organizations", validate({ body: createOrgSchema }), platformController.createOrganization);
router.get("/organizations", platformController.listOrganizations);

router.post("/users", validate({ body: createPlatformUserSchema }), platformController.createUser);
router.get("/developers", platformController.listDevelopers);

router.get("/projects", platformController.listAllProjects);
router.post(
  "/projects/:id/developers",
  validate({ body: assignDeveloperSchema }),
  platformController.assignDeveloper
);
router.delete("/projects/:id/developers/:userId", platformController.unassignDeveloper);

export default router;
