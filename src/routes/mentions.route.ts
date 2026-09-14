import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import * as mentionsController from "../controllers/mentions.controller";

const router = Router();

router.use(auth());

router.get("/", mentionsController.listMentions);

export default router;
