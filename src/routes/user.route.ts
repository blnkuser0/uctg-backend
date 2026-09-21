import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { PERMISSIONS } from "../constants/permissions";
import { createUserSchema, updateUserSchema } from "../validations/user.validation";
import { userIdParamSchema } from "../validations/idCard.validation";
import * as userController from "../controllers/user.controller";
import * as idCardController from "../controllers/idCard.controller";

const router = Router();

router.use(auth());

router.get("/", userController.listUsers);
router.get("/search", userController.searchUsers);
router.get("/me/id-card", idCardController.getMyIdCard);
router.get("/:id/id-card", validate({ params: userIdParamSchema }), idCardController.getUserIdCard);
router.post(
  "/",
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate({ body: createUserSchema }),
  userController.createUser
);
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate({ body: updateUserSchema }),
  userController.updateUser
);
router.delete("/:id", requirePermission(PERMISSIONS.USERS_MANAGE), userController.deactivateUser);
// Puts the account back on the shared temporary password and (tries to) email it.
router.post(
  "/:id/reset-password",
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate({ params: userIdParamSchema }),
  userController.resetPassword
);
// Permanent removal (soft-deleted, see userService.deleteUser); DELETE /:id above only deactivates.
router.delete(
  "/:id/permanent",
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate({ params: userIdParamSchema }),
  userController.deleteUser
);

export default router;
