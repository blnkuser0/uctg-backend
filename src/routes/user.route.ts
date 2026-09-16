import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { requireSuperAdmin } from "../middlewares/role.middleware";
import { createUserSchema, updateUserSchema } from "../validations/user.validation";
import * as userController from "../controllers/user.controller";

const router = Router();

router.use(auth());
router.use(requireSuperAdmin);

router.get("/", userController.listUsers);
router.get("/search", userController.searchUsers);
router.post(
  "/",
  validate({ body: createUserSchema }),
  userController.createUser
);
router.patch(
  "/:id",
  validate({ body: updateUserSchema }),
  userController.updateUser
);
router.delete("/:id", userController.deactivateUser);

export default router;
