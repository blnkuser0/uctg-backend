import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { markNotificationsReadSchema } from "../validations/notification.validation";
import * as notificationController from "../controllers/notification.controller";

const router = Router();

router.use(auth());

router.get("/", notificationController.listNotifications);
router.get("/count", notificationController.countNotifications);
router.post("/read", validate({ body: markNotificationsReadSchema }), notificationController.markRead);

export default router;
