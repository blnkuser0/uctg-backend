import { Router } from "express";
import * as fileController from "../controllers/file.controller";

const router = Router();
router.get("/db-:id", fileController.download);
export default router;
