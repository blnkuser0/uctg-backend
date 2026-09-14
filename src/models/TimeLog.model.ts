import { Schema, model, Document, Types } from "mongoose";

export const TIME_LOG_TYPES = ["time-in", "time-out", "break-in", "break-out", "lunch-in", "lunch-out"] as const;
export type TimeLogType = (typeof TIME_LOG_TYPES)[number];

export interface ITimeLog extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  type: TimeLogType;
  timestamp: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TimeLogSchema = new Schema<ITimeLog>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: TIME_LOG_TYPES, required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    note: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

TimeLogSchema.index({ organizationId: 1, userId: 1, timestamp: 1 });

export const TimeLog = model<ITimeLog>("TimeLog", TimeLogSchema);
