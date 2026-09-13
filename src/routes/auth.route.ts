import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { authLimiter } from "../middlewares/rateLimit.middleware";
import { registerSchema, loginSchema, changePasswordSchema, updateMeSchema } from "../validations/auth.validation";
import * as authController from "../controllers/auth.controller";

const router = Router();

router.post("/register", authLimiter, validate({ body: registerSchema }), authController.register);
router.post("/login", authLimiter, validate({ body: loginSchema }), authController.login);
router.post("/refresh-tokens", authController.refreshTokens);
router.post("/logout", auth(), authController.logout);
router.get("/me", auth(), authController.getMe);
router.patch("/me", auth(), validate({ body: updateMeSchema }), authController.updateMe);
router.post(
  "/change-password",
  auth(),
  validate({ body: changePasswordSchema }),
  authController.changePassword
);

export default router;
