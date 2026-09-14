import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { PERMISSIONS } from "../constants/permissions";
import { updateOrganizationSchema } from "../validations/organization.validation";
import * as organizationController from "../controllers/organization.controller";

const router = Router();

router.use(auth());

router.get("/", organizationController.getOrganization);
router.patch("/", requirePermission(PERMISSIONS.ORG_MANAGE), validate({ body: updateOrganizationSchema }), organizationController.updateOrganization);

export default router;
