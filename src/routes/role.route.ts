import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";
import * as roleController from "../controllers/role.controller";

const router = Router();

router.use(auth(), requireSuperAdmin);

router.get("/", roleController.listRoles);

export default router;
