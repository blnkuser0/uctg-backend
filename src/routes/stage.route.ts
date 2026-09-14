import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { updateStageSchema, deleteStageSchema } from "../validations/stage.validation";
import * as stageController from "../controllers/stage.controller";

const router = Router();

router.use(auth());

router.patch("/:id", validate({ body: updateStageSchema }), stageController.updateStage);
router.delete("/:id", validate({ body: deleteStageSchema }), stageController.deleteStage);

export default router;
