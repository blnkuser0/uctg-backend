import { Schema, model, Document, Types } from "mongoose";
import { IAttachment } from "./Task.model";

const AttachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: true },
    fileKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

export interface IMessageReaction {
  emoji: string;
  userIds: Types.ObjectId[];
}

const ReactionSchema = new Schema<IMessageReaction>(
  {
    emoji: { type: String, required: true },
    userIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { _id: false }
);

export interface IMessage extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  channelId: Types.ObjectId;
  userId: Types.ObjectId;
  authorName: string;
  authorAvatar: string | null;
  message: string;
  mentions: Types.ObjectId[];
  attachments: IAttachment[];
  reactions: IMessageReaction[];
  // The message this one is quoting, if any. Kept as a bare reference (not a snapshot) so an
  // edit to the original is reflected wherever it's quoted; message.service.ts attaches a
  // lightweight `replyPreview` when listing, rather than this being populated on the document.
  replyToId: Types.ObjectId | null;
  pinnedAt: Date | null;
  pinnedBy: Types.ObjectId | null;
  isEdited: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorAvatar: { type: String, default: null },
    message: { type: String, trim: true, maxlength: 10000, default: "" },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    attachments: { type: [AttachmentSchema], default: [] },
    reactions: { type: [ReactionSchema], default: [] },
    replyToId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    pinnedAt: { type: Date, default: null },
    pinnedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    isEdited: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MessageSchema.index({ channelId: 1, deletedAt: 1, createdAt: -1 });
MessageSchema.index({ mentions: 1, deletedAt: 1, createdAt: -1 });
// `pinnedAt` defaults to `null` (not "missing") on every message, same as `Channel.dmKey` — see
// the long comment on that index for why `sparse: true` wouldn't actually exclude the unpinned
// majority here. Not a correctness bug this time (this index isn't unique), just the same
// non-fix, so it's written the way that's actually true from the start.
MessageSchema.index({ channelId: 1, pinnedAt: -1 }, { partialFilterExpression: { pinnedAt: { $type: "date" } } });

export const Message = model<IMessage>("Message", MessageSchema);
