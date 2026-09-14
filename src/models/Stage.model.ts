import { Schema, model, Document, Types } from "mongoose";

export interface IStage extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  color: string;
  order: number;
  isDoneStage: boolean;
  wipLimit: number | null;
  createdBy: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const StageSchema = new Schema<IStage>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    color: { type: String, default: "#94a3b8" },
    order: { type: Number, default: 0 },
    isDoneStage: { type: Boolean, default: false },
    wipLimit: { type: Number, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

StageSchema.index({ projectId: 1, deletedAt: 1, order: 1 });

export const Stage = model<IStage>("Stage", StageSchema);
