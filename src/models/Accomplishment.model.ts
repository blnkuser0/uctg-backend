import { Schema, model, Document, Types } from "mongoose";

export interface IAccomplishment extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  // PH calendar day (YYYY-MM-DD), not a Date — matches the frontend's toPhDateKey convention
  // used elsewhere in the app, and sidesteps timezone-conversion bugs entirely since it's a
  // plain lexically-sortable string, not an instant that needs a timezone to interpret.
  date: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const AccomplishmentSchema = new Schema<IAccomplishment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

AccomplishmentSchema.index({ organizationId: 1, userId: 1, date: -1 });
AccomplishmentSchema.index({ organizationId: 1, date: -1 });

export const Accomplishment = model<IAccomplishment>("Accomplishment", AccomplishmentSchema);
