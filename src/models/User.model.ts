import { randomBytes } from "crypto";
import { Schema, model, Document, Types } from "mongoose";
import { nextSequence } from "./Counter.model";

export const EMPLOYEE_ID_PREFIX = "UGX";

export async function nextEmployeeId(): Promise<string> {
  const seq = await nextSequence("employeeId");
  return `${EMPLOYEE_ID_PREFIX}-${String(seq).padStart(4, "0")}`;
}

// Unguessable, so the QR verification URL can't be enumerated by counting
// employee IDs. Never derived from anything about the user.
export function generateIdToken(): string {
  return randomBytes(16).toString("hex");
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  organizationId: Types.ObjectId;
  roleId: Types.ObjectId;
  avatarUrl: string | null;
  isActive: boolean;
  // Set when an admin deletes the account. The row is kept so old comments,
  // messages and time records still show who wrote them, but it is hidden from
  // every list, can't sign in, and its email is freed for reuse.
  deletedAt: Date | null;
  tokenVersion: number;
  lastLoginAt: Date | null;
  passwordResetTokenHash: string | null;
  passwordResetExpires: Date | null;
  // Platform-wide bypass, independent of organizationId/roleId — a Super
  // Admin still has a normal home org + role (for ordinary org-scoped
  // actions), but this flag is what actually grants cross-org access in
  // authorization code. Not a Role/permission because Role is structurally
  // org-bound (organizationId required, unique per org).
  isSuperAdmin: boolean;
  // True for accounts an admin created with a password they chose (and emailed).
  // Cleared the moment the user sets their own password.
  mustChangePassword: boolean;
  // Company ID number (e.g. UGX-0001) and the secret behind the ID card's QR
  // code. Set automatically for every new user; older accounts are backfilled
  // the first time their ID card is requested.
  employeeId?: string;
  idToken?: string;
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
    deletedAt: { type: Date, default: null, index: true },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpires: { type: Date, default: null, select: false },
    isSuperAdmin: { type: Boolean, default: false, index: true },
    mustChangePassword: { type: Boolean, default: false },
    employeeId: { type: String, unique: true, sparse: true },
    idToken: { type: String, unique: true, sparse: true, select: false },
  },
  { timestamps: true }
);

UserSchema.pre("validate", async function () {
  if (!this.isNew) return;
  if (!this.employeeId) this.employeeId = await nextEmployeeId();
  if (!this.idToken) this.idToken = generateIdToken();
});

export const User = model<IUser>("User", UserSchema);
