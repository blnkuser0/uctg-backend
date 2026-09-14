import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { PERMISSIONS } from "../constants/permissions";
import { createRoleSchema, updateRoleSchema } from "../validations/role.validation";
import * as roleController from "../controllers/role.controller";

const router = Router();

router.use(auth(), requirePermission(PERMISSIONS.ROLES_MANAGE));

router.post("/", validate({ body: createRoleSchema }), roleController.createRole);
router.get("/", roleController.listRoles);
router.patch("/:id", validate({ body: updateRoleSchema }), roleController.updateRole);
router.delete("/:id", roleController.deleteRole);

export default router;
