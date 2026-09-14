import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { upload } from "../middlewares/upload.middleware";
import {
  updateTaskSchema,
  moveTaskSchema,
  createSubtaskSchema,
  createChecklistItemSchema,
  updateChecklistItemSchema,
  reorderChecklistItemsSchema,
} from "../validations/task.validation";
import { createManualTimeEntrySchema } from "../validations/timeEntry.validation";
import { createCommentSchema, updateCommentSchema } from "../validations/comment.validation";
import * as taskController from "../controllers/task.controller";
import * as timeEntryController from "../controllers/timeEntry.controller";
import * as commentController from "../controllers/comment.controller";

const router = Router();

router.use(auth());

router.get("/:id", taskController.getTask);
router.patch("/:id", validate({ body: updateTaskSchema }), taskController.updateTask);
router.delete("/:id", taskController.deleteTask);
router.patch("/:id/move", validate({ body: moveTaskSchema }), taskController.moveTask);

router.post("/:id/subtasks", validate({ body: createSubtaskSchema }), taskController.createSubtask);
router.get("/:id/subtasks", taskController.listSubtasks);

router.post("/:id/checklist-items", validate({ body: createChecklistItemSchema }), taskController.addChecklistItem);
router.patch(
  "/:id/checklist-items/reorder",
  validate({ body: reorderChecklistItemsSchema }),
  taskController.reorderChecklistItems
);
router.patch(
  "/:id/checklist-items/:itemId",
  validate({ body: updateChecklistItemSchema }),
  taskController.updateChecklistItem
);
router.delete("/:id/checklist-items/:itemId", taskController.deleteChecklistItem);

router.post("/:id/attachments", upload.array("files", 10), taskController.addAttachment);
router.delete("/:id/attachments/:attachmentId", taskController.removeAttachment);

router.post("/:id/timer/start", timeEntryController.startTimer);
router.post("/:id/timer/stop", timeEntryController.stopTimer);
router.post("/:id/time-entries", validate({ body: createManualTimeEntrySchema }), timeEntryController.createManualEntry);
router.get("/:id/time-entries", timeEntryController.listForTask);

router.get("/:id/comments", commentController.listForTask);
router.post("/:id/comments", validate({ body: createCommentSchema }), commentController.createComment);

export default router;
