import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { upload } from "../middlewares/upload.middleware";
import { createDmSchema, createGroupSchema, updateGroupSchema, setPinnedSchema, setMutedSchema } from "../validations/channel.validation";
import { createMessageSchema, listMessagesQuerySchema, searchChannelQuerySchema } from "../validations/message.validation";
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
router.post("/:id/unread", channelController.markUnread);
router.post("/:id/pin", validate({ body: setPinnedSchema }), channelController.setPinned);
router.post("/:id/mute", validate({ body: setMutedSchema }), channelController.setMuted);
router.post("/:id/hide", channelController.hideDm);

router.get("/:id/messages", validate({ query: listMessagesQuerySchema }), messageController.listForChannel);
router.post("/:id/messages", validate({ body: createMessageSchema }), messageController.createMessage);
router.post("/:id/attachments", upload.array("files", 10), messageController.addAttachments);
router.get("/:id/pinned-messages", messageController.listPinned);
router.get("/:id/search", validate({ query: searchChannelQuerySchema }), messageController.searchInChannel);

export default router;
