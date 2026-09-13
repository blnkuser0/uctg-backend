import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createUserSchema, updateUserSchema } from "../validations/user.validation";
import * as userController from "../controllers/user.controller";

const router = Router();

router.use(auth());

router.get("/", userController.listUsers);
router.get("/search", userController.searchUsers);
router.post("/", requireAdmin, validate({ body: createUserSchema }), userController.createUser);
router.patch("/:id", requireAdmin, validate({ body: updateUserSchema }), userController.updateUser);
router.delete("/:id", requireAdmin, userController.deactivateUser);

export default router;
