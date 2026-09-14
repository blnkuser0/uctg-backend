import { Schema, model, Document, Types } from "mongoose";
import { NOTIFICATION_TYPES, NotificationType } from "../constants/notifications";

export interface INotification extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  projectId: Types.ObjectId | null;
  taskId: Types.ObjectId | null;
  commentId: Types.ObjectId | null;
  leaveId: Types.ObjectId | null;
  channelId: Types.ObjectId | null;
  messageId: Types.ObjectId | null;
  actorId: Types.ObjectId;
  actorName: string;
  title: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    commentId: { type: Schema.Types.ObjectId, ref: "TaskComment", default: null },
    leaveId: { type: Schema.Types.ObjectId, ref: "Leave", default: null },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", default: null },
    messageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = model<INotification>("Notification", NotificationSchema);
