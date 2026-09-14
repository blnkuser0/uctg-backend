import { Schema, model, Document, Types } from "mongoose";

export const LEAVE_DECISION_STATUSES = ["pending", "approved", "rejected"] as const;
export type LeaveDecisionStatus = (typeof LEAVE_DECISION_STATUSES)[number];

export interface ILeave extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  reason: string;
  hrStatus: LeaveDecisionStatus;
  hrDecidedBy: Types.ObjectId | null;
  hrDecidedAt: Date | null;
  hrNote: string | null;
  adminStatus: LeaveDecisionStatus;
  adminDecidedBy: Types.ObjectId | null;
  adminDecidedAt: Date | null;
  adminNote: string | null;
  status: LeaveDecisionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveSchema = new Schema<ILeave>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },

    hrStatus: { type: String, enum: LEAVE_DECISION_STATUSES, default: "pending" },
    hrDecidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    hrDecidedAt: { type: Date, default: null },
    hrNote: { type: String, default: null, maxlength: 500 },

    adminStatus: { type: String, enum: LEAVE_DECISION_STATUSES, default: "pending" },
    adminDecidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    adminDecidedAt: { type: Date, default: null },
    adminNote: { type: String, default: null, maxlength: 500 },

    // Denormalized overall outcome — see computeOverallStatus() in leave.service.ts.
    // Admin has the final say: pending until Admin decides, then mirrors Admin's
    // decision regardless of what HR chose.
    status: { type: String, enum: LEAVE_DECISION_STATUSES, default: "pending", index: true },
  },
  { timestamps: true }
);

LeaveSchema.index({ organizationId: 1, status: 1 });
LeaveSchema.index({ organizationId: 1, userId: 1 });

export const Leave = model<ILeave>("Leave", LeaveSchema);
