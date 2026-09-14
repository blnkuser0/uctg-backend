import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import * as timeEntryController from "../controllers/timeEntry.controller";

const router = Router();

router.use(auth());

router.delete("/:id", timeEntryController.deleteEntry);

export default router;
