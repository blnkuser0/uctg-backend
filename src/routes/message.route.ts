import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { reactToMessageSchema, updateMessageSchema } from "../validations/message.validation";
import * as messageController from "../controllers/message.controller";

const router = Router();

router.use(auth());

router.patch("/:id", validate({ body: updateMessageSchema }), messageController.updateMessage);
router.delete("/:id", messageController.deleteMessage);
router.post("/:id/react", validate({ body: reactToMessageSchema }), messageController.reactToMessage);
router.post("/:id/pin", messageController.togglePinMessage);

export default router;
