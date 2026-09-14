import { Schema, model, Document, Types } from "mongoose";

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface IProject extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  key: string;
  description: string;
  color: string;
  status: ProjectStatus;
  createdBy: Types.ObjectId;
  memberIds: Types.ObjectId[];
  taskSeq: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    key: { type: String, required: true, trim: true, uppercase: true, maxlength: 10 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    color: { type: String, default: "#f59e0b" },
    status: { type: String, enum: PROJECT_STATUSES, default: "active" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    memberIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    taskSeq: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProjectSchema.index({ organizationId: 1, memberIds: 1, deletedAt: 1, status: 1 });
ProjectSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const Project = model<IProject>("Project", ProjectSchema);
