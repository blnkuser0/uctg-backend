import { Schema, model, Document, Types } from "mongoose";

export const CHANNEL_TYPES = ["dm", "group", "project"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface IChannel extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  type: ChannelType;
  name: string | null;
  projectId: Types.ObjectId | null;
  memberIds: Types.ObjectId[];
  dmKey: string | null;
  createdBy: Types.ObjectId;
  lastMessageAt: Date | null;
  deletedAt: Date | null;
  // Per-viewer conversation-list state — each is "who has this set", not a single flag, since
  // pinning/muting/hiding one person's copy of a DM or group must never affect anyone else's.
  pinnedBy: Types.ObjectId[];
  mutedBy: Types.ObjectId[];
  // Only meaningful for "dm" — "deleted" a conversation without ending it for the other side.
  // Cleared automatically (for everyone who'd hidden it) the moment a new message arrives, or the
  // DM is re-initiated — same behavior as SupraSpace's per-user conversation delete.
  hiddenFor: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ChannelSchema = new Schema<IChannel>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    type: { type: String, enum: CHANNEL_TYPES, required: true },
    name: { type: String, default: null, trim: true, maxlength: 80 },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    memberIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    dmKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastMessageAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    pinnedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    mutedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    hiddenFor: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

ChannelSchema.index({ organizationId: 1, memberIds: 1, deletedAt: 1 });
// `sparse: true` only skips documents where dmKey is MISSING — every group/project channel has
// it explicitly set to `null` (the schema default), so a sparse index still indexes all of them,
// and a unique constraint on "organizationId + null" collides the moment a second one exists in
// the same org (the exact bug behind "can't create a group/project chat"). A partial index
// scoped to actual (string) dmKeys is what "only DMs" needs. See scripts/fix-channel-dm-index.ts
// to repair a database that already has the old, broken index — an existing DB won't pick up
// this rename/redefinition on its own.
ChannelSchema.index(
  { organizationId: 1, dmKey: 1 },
  { unique: true, partialFilterExpression: { dmKey: { $type: "string" } }, name: "organizationId_1_dmKey_1_partial" }
);
ChannelSchema.index({ projectId: 1 }, { sparse: true });

export const Channel = model<IChannel>("Channel", ChannelSchema);
