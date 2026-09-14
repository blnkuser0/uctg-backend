import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { PERMISSIONS } from "../constants/permissions";
import { clockSchema, dateQuerySchema, monthQuerySchema } from "../validations/timeLog.validation";
import * as timeLogController from "../controllers/timeLog.controller";

const router = Router();

router.use(auth());

router.get("/today", timeLogController.getToday);
router.post("/clock", validate({ body: clockSchema }), timeLogController.clock);
router.get("/calendar", validate({ query: monthQuerySchema }), timeLogController.getMonthSummary);
router.get(
  "/team",
  requirePermission(PERMISSIONS.ATTENDANCE_VIEW_ALL),
  validate({ query: dateQuerySchema }),
  timeLogController.getTeamDaySummary
);

export default router;
