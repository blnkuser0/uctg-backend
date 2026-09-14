import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { updateCommentSchema } from "../validations/comment.validation";
import * as commentController from "../controllers/comment.controller";

const router = Router();

router.use(auth());

router.patch("/:id", validate({ body: updateCommentSchema }), commentController.updateComment);
router.delete("/:id", commentController.deleteComment);

export default router;
