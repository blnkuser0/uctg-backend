import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/permission.middleware";
import { validate } from "../middlewares/validate.middleware";
import { PERMISSIONS } from "../constants/permissions";
import {
  createAccomplishmentSchema,
  updateAccomplishmentSchema,
  listAccomplishmentsQuerySchema,
} from "../validations/accomplishment.validation";
import * as accomplishmentController from "../controllers/accomplishment.controller";

const router = Router();

router.use(auth());
// Every route here needs the same permission — unlike Leaves, logging your OWN entry isn't
// open to everyone; it's deliberately gated the same as the team-wide view.
router.use(requirePermission(PERMISSIONS.ACCOMPLISHMENTS_MANAGE));

router.post("/", validate({ body: createAccomplishmentSchema }), accomplishmentController.create);
router.get("/mine", validate({ query: listAccomplishmentsQuerySchema }), accomplishmentController.listMine);
router.get("/", validate({ query: listAccomplishmentsQuerySchema }), accomplishmentController.listAll);
router.patch("/:id", validate({ body: updateAccomplishmentSchema }), accomplishmentController.update);
router.delete("/:id", accomplishmentController.remove);

export default router;
