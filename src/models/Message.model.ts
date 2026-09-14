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
    isEdited: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MessageSchema.index({ channelId: 1, deletedAt: 1, createdAt: -1 });
MessageSchema.index({ mentions: 1, deletedAt: 1, createdAt: -1 });

export const Message = model<IMessage>("Message", MessageSchema);
