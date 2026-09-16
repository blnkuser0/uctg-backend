import { Router } from "express";
import { auth } from "../middlewares/auth.middleware";
import { projectContext } from "../middlewares/projectContext.middleware";
import { validate } from "../middlewares/validate.middleware";
import { createProjectSchema, updateProjectSchema, addMemberSchema } from "../validations/project.validation";
import { createStageSchema, reorderStagesSchema } from "../validations/stage.validation";
import { createLabelSchema } from "../validations/label.validation";
import { createTaskSchema, listTasksQuerySchema } from "../validations/task.validation";
import * as projectController from "../controllers/project.controller";
import * as stageController from "../controllers/stage.controller";
import * as labelController from "../controllers/label.controller";
import * as taskController from "../controllers/task.controller";

const router = Router();

router.use(auth());

router.post("/", validate({ body: createProjectSchema }), projectController.createProject);
router.get("/", projectController.listProjects);
router.use("/:id", projectContext);
router.get("/:id", projectController.getProject);
router.get("/:id/report", projectController.getReport);
router.patch("/:id", validate({ body: updateProjectSchema }), projectController.updateProject);
router.delete("/:id", projectController.deleteProject);
router.post("/:id/members", validate({ body: addMemberSchema }), projectController.addMember);
router.delete("/:id/members/:userId", projectController.removeMember);

// Nested under a project
router.get("/:id/stages", stageController.listStages);
router.post("/:id/stages", validate({ body: createStageSchema }), stageController.createStage);
router.patch("/:id/stages/reorder", validate({ body: reorderStagesSchema }), stageController.reorderStages);

router.get("/:id/labels", labelController.listLabels);
router.post("/:id/labels", validate({ body: createLabelSchema }), labelController.createLabel);

router.get("/:id/tasks", validate({ query: listTasksQuerySchema }), taskController.listTasks);
router.post("/:id/tasks", validate({ body: createTaskSchema }), taskController.createTask);

export default router;
