import { Schema, model, Document, Types } from "mongoose";

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  organizationId: Types.ObjectId;
  roleId: Types.ObjectId;
  avatarUrl: string | null;
  isActive: boolean;
  tokenVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: "Role", required: true, index: true },
    avatarUrl: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", UserSchema);
