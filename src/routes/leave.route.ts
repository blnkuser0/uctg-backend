import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { PERMISSIONS } from "../constants/permissions";
import { createLeaveSchema, leaveDecisionSchema } from "../validations/leave.validation";
import * as leaveController from "../controllers/leave.controller";

const router = Router();

router.use(auth());

router.post("/", validate({ body: createLeaveSchema }), leaveController.createLeave);
router.get("/mine", leaveController.listMine);
router.get("/", requirePermission(PERMISSIONS.LEAVES_VIEW_ALL), leaveController.listAll);
router.patch(
  "/:id/hr-decision",
  requirePermission(PERMISSIONS.LEAVES_APPROVE_HR),
  validate({ body: leaveDecisionSchema }),
  leaveController.hrDecision
);
router.patch(
  "/:id/admin-decision",
  requirePermission(PERMISSIONS.LEAVES_APPROVE_ADMIN),
  validate({ body: leaveDecisionSchema }),
  leaveController.adminDecision
);
router.delete("/:id", leaveController.cancelLeave);

export default router;
