import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { updateMessageSchema } from "../validations/message.validation";
import * as messageController from "../controllers/message.controller";

const router = Router();

router.use(auth());

router.patch("/:id", validate({ body: updateMessageSchema }), messageController.updateMessage);
router.delete("/:id", messageController.deleteMessage);

export default router;
