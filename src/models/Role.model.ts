import { Schema, model, Document, Types } from "mongoose";
import { Permission } from "../constants/permissions";

export interface IRole extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<IRole>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    permissions: { type: [String], default: [] },
  },
  { timestamps: true }
);

RoleSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const Role = model<IRole>("Role", RoleSchema);
