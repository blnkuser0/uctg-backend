import { Schema, model, Document, Types } from "mongoose";

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];
export const ORGANIZATION_KINDS = ["umbrella", "client"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export interface IOrganization extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    kind: { type: String, enum: ORGANIZATION_KINDS, default: "client", required: true, index: true },
    // Reserved for future use (no suspension logic is enforced yet).
    status: { type: String, enum: ORGANIZATION_STATUSES, default: "active" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const Organization = model<IOrganization>("Organization", OrganizationSchema);
