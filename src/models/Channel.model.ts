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
  },
  { timestamps: true }
);

ChannelSchema.index({ organizationId: 1, memberIds: 1, deletedAt: 1 });
ChannelSchema.index({ organizationId: 1, dmKey: 1 }, { unique: true, sparse: true });
ChannelSchema.index({ projectId: 1 }, { sparse: true });

export const Channel = model<IChannel>("Channel", ChannelSchema);
