import { Schema, model } from "mongoose";

// Generic atomic counters — currently only used for employee ID numbers.
interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model<ICounter>("Counter", CounterSchema);

export async function nextSequence(name: string): Promise<number> {
  // Two first-ever callers can race on the upsert and one hits a duplicate
  // key error; the retry then simply increments the freshly created doc.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      return counter.seq;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000 || attempt === 1) throw error;
    }
  }
  throw new Error("unreachable");
}
