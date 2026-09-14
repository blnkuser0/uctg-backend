import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { upload } from "../middlewares/upload.middleware";
import { createDmSchema, createGroupSchema, updateGroupSchema } from "../validations/channel.validation";
import { createMessageSchema, listMessagesQuerySchema } from "../validations/message.validation";
import * as channelController from "../controllers/channel.controller";
import * as messageController from "../controllers/message.controller";

const router = Router();

router.use(auth());

router.get("/", channelController.listChannels);
router.post("/dm", validate({ body: createDmSchema }), channelController.createDm);
router.post("/", validate({ body: createGroupSchema }), channelController.createGroup);
router.patch("/:id", validate({ body: updateGroupSchema }), channelController.updateGroup);
router.delete("/:id", channelController.deleteGroup);
router.post("/:id/read", channelController.markRead);

router.get("/:id/messages", validate({ query: listMessagesQuerySchema }), messageController.listForChannel);
router.post("/:id/messages", validate({ body: createMessageSchema }), messageController.createMessage);
router.post("/:id/attachments", upload.array("files", 10), messageController.addAttachments);

export default router;
