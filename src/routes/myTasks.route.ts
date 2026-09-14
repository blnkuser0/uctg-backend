import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import * as taskController from "../controllers/task.controller";

const router = Router();

router.use(auth());

router.get("/", taskController.listMyTasks);

export default router;
