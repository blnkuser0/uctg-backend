import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { authLimiter } from "../middlewares/rateLimit.middleware";
import { upload } from "../middlewares/upload.middleware";
import {
  loginSchema,
  changePasswordSchema,
  updateMeSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validations/auth.validation";
import * as authController from "../controllers/auth.controller";

const router = Router();

// No public /register — Organizations/accounts are Super-Admin-provisioned
// only now, via /api/platform (see platform.route.ts).
router.post("/login", authLimiter, validate({ body: loginSchema }), authController.login);
router.post("/refresh-tokens", authController.refreshTokens);
router.post("/logout", auth(), authController.logout);
router.get("/me", auth(), authController.getMe);
router.patch("/me", auth(), validate({ body: updateMeSchema }), authController.updateMe);
router.post("/me/avatar", auth(), upload.single("avatar"), authController.uploadAvatar);
router.post(
  "/change-password",
  auth(),
  validate({ body: changePasswordSchema }),
  authController.changePassword
);
router.post(
  "/forgot-password",
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword
);
router.post(
  "/reset-password",
  authLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword
);

export default router;
