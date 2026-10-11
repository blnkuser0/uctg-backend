import { Schema, model, Document, Types } from "mongoose";

export type AccomplishmentSection = "accomplishment" | "blockers" | "inProgress";
export const ACCOMPLISHMENT_SECTIONS: AccomplishmentSection[] = ["accomplishment", "blockers", "inProgress"];

export interface IAccomplishmentAttachment {
  url: string;
  fileKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  // Which of the three sections this file was attached to — mirrors the shared,
  // section-tagged attachment array from Suprah's Daypulse rather than three
  // separate arrays.
  section: AccomplishmentSection;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
}

const AccomplishmentAttachmentSchema = new Schema<IAccomplishmentAttachment>(
  {
    url: { type: String, required: true },
    fileKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    section: { type: String, enum: ACCOMPLISHMENT_SECTIONS, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

export interface IAccomplishment extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  // PH calendar day (YYYY-MM-DD), not a Date — matches the frontend's toPhDateKey convention
  // used elsewhere in the app, and sidesteps timezone-conversion bugs entirely since it's a
  // plain lexically-sortable string, not an instant that needs a timezone to interpret.
  date: string;
  accomplishment: string;
  blockers: string;
  inProgress: string;
  attachments: IAccomplishmentAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const AccomplishmentSchema = new Schema<IAccomplishment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    accomplishment: { type: String, required: true, trim: true, maxlength: 5000 },
    // Optional — not every day has a blocker or something still in progress.
    blockers: { type: String, default: "", trim: true, maxlength: 5000 },
    inProgress: { type: String, default: "", trim: true, maxlength: 5000 },
    attachments: { type: [AccomplishmentAttachmentSchema], default: [] },
  },
  { timestamps: true }
);

AccomplishmentSchema.index({ organizationId: 1, userId: 1, date: -1 });
AccomplishmentSchema.index({ organizationId: 1, date: -1 });

export const Accomplishment = model<IAccomplishment>("Accomplishment", AccomplishmentSchema);
