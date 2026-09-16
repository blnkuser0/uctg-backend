import { Schema, model, Document, Types } from "mongoose";

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

// "internal" identifies the single, shared Developers organization every
// developer belongs to; every client workspace is "client" (the default, so
// existing/self-registered orgs are unaffected). Used to look up the
// Developers org by query (`Organization.findOne({ type: "internal" })`)
// instead of a hardcoded slug/id.
export const ORGANIZATION_TYPES = ["internal", "client"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export interface IOrganization extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: OrganizationStatus;
  type: OrganizationType;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    // Reserved for future use (no suspension logic is enforced yet).
    status: { type: String, enum: ORGANIZATION_STATUSES, default: "active" },
    type: { type: String, enum: ORGANIZATION_TYPES, default: "client", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const Organization = model<IOrganization>("Organization", OrganizationSchema);
