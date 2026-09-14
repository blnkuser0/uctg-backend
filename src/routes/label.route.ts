import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { updateLabelSchema } from "../validations/label.validation";
import * as labelController from "../controllers/label.controller";

const router = Router();

router.use(auth());

router.patch("/:id", validate({ body: updateLabelSchema }), labelController.updateLabel);
router.delete("/:id", labelController.deleteLabel);

export default router;
