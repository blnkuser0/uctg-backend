import { Schema, model, Document, Types } from "mongoose";
import { TASK_PRIORITIES, TaskPriority } from "../constants/taskEnums";

export type ReminderStage = "d3" | "d1" | "d0";

export interface IChecklistItem {
  _id: Types.ObjectId;
  text: string;
  isChecked: boolean;
  order: number;
  completedBy: Types.ObjectId | null;
  completedAt: Date | null;
}

const ChecklistItemSchema = new Schema<IChecklistItem>(
  {
    text: { type: String, required: true, trim: true, maxlength: 300 },
    isChecked: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    completedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: true }
);

export interface IAttachment {
  url: string;
  fileKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
}

const AttachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: true },
    fileKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

export interface ITask extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  stageId: Types.ObjectId;
  parentTaskId: Types.ObjectId | null;
  taskNumber: number;
  title: string;
  description: string;
  priority: TaskPriority | null;
  labelIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  assigneeIds: Types.ObjectId[];
  startDate: Date | null;
  deadline: Date | null;
  order: number;
  checklist: IChecklistItem[];
  checklistProgress: number;
  estimateMinutes: number | null;
  trackedMinutes: number;
  attachments: IAttachment[];
  commentCount: number;
  seenBy: Types.ObjectId[];
  remindersSent: ReminderStage[];
  completedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    stageId: { type: Schema.Types.ObjectId, ref: "Stage", required: true },
    parentTaskId: { type: Schema.Types.ObjectId, ref: "Task", default: null, index: true },
    taskNumber: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 20000, default: "" },
    priority: { type: String, enum: [...TASK_PRIORITIES, null], default: "normal" },
    labelIds: [{ type: Schema.Types.ObjectId, ref: "Label" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    startDate: { type: Date, default: null },
    deadline: { type: Date, default: null },
    order: { type: Number, default: 0 },
    checklist: { type: [ChecklistItemSchema], default: [] },
    checklistProgress: { type: Number, default: 0 },
    estimateMinutes: { type: Number, default: null },
    trackedMinutes: { type: Number, default: 0 },
    attachments: { type: [AttachmentSchema], default: [] },
    commentCount: { type: Number, default: 0 },
    seenBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    remindersSent: { type: [String], default: [] },
    completedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TaskSchema.index({ stageId: 1, deletedAt: 1, order: 1 });
TaskSchema.index({ organizationId: 1, projectId: 1, deletedAt: 1 });
TaskSchema.index({ assigneeIds: 1, deletedAt: 1 });
TaskSchema.index({ deadline: 1, deletedAt: 1 });
TaskSchema.index({ labelIds: 1 });
TaskSchema.index({ projectId: 1, taskNumber: 1 }, { unique: true });

export const Task = model<ITask>("Task", TaskSchema);
