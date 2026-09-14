import { Schema, model, Document, Types } from "mongoose";

export type TimeEntrySource = "timer" | "manual";

export interface ITimeEntry extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  source: TimeEntrySource;
  startedAt: Date;
  endedAt: Date | null;
  durationMinutes: number | null;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const TimeEntrySchema = new Schema<ITimeEntry>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: ["timer", "manual"], required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: null },
    note: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

TimeEntrySchema.index({ taskId: 1, createdAt: -1 });
TimeEntrySchema.index({ userId: 1, endedAt: 1 });
TimeEntrySchema.index({ projectId: 1, userId: 1, startedAt: 1 });

export const TimeEntry = model<ITimeEntry>("TimeEntry", TimeEntrySchema);
