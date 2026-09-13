import { Router } from "express";
import { isDbConnected } from "../config/db";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    dbConnected: isDbConnected(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
