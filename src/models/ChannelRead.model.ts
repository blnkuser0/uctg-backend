import { Schema, model, Document, Types } from "mongoose";

export interface IChannelRead extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  channelId: Types.ObjectId;
  userId: Types.ObjectId;
  lastReadAt: Date;
  // Set by an explicit "mark as unread" action — forces the channel to show as unread even
  // though lastReadAt says otherwise, until the user opens it again (markRead clears this too).
  manualUnread: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelReadSchema = new Schema<IChannelRead>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastReadAt: { type: Date, required: true, default: Date.now },
    manualUnread: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChannelReadSchema.index({ channelId: 1, userId: 1 }, { unique: true });

export const ChannelRead = model<IChannelRead>("ChannelRead", ChannelReadSchema);
