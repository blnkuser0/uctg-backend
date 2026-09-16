import { Schema, model, Document, Types } from "mongoose";
import { Permission } from "../constants/permissions";
import { SYSTEM_ROLES, SystemRole } from "../constants/roles";

export interface IRole extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: SystemRole;
  permissions: Permission[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<IRole>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, enum: SYSTEM_ROLES, trim: true, maxlength: 60 },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RoleSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const Role = model<IRole>("Role", RoleSchema);
