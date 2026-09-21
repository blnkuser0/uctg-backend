import { Router } from "express";
import { validate } from "../middlewares/validate.middleware";
import { verifyLimiter } from "../middlewares/rateLimit.middleware";
import { verifyTokenParamSchema } from "../validations/idCard.validation";
import * as idCardController from "../controllers/idCard.controller";

const router = Router();

// Unauthenticated on purpose: this is what the QR code on a company ID opens.
router.get(
  "/verify/:token",
  verifyLimiter,
  validate({ params: verifyTokenParamSchema }),
  idCardController.verifyIdCard
);

export default router;
