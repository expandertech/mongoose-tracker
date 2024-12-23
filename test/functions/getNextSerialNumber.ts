import CounterModel from "../models/counter";

// Reusable function to get the next number for any type (PD, PO, EX)
type CounterType = 'PD' | 'PO' | 'EX' | 'CO';

export async function getNextSerialNumber(type: CounterType): Promise<string> {
  const result = await CounterModel.findOneAndUpdate(
    { type: type },
    { $inc: { lastNumber: 1 } },
    { returnDocument: 'after', upsert: true },
  );
  const nextNumber = result.lastNumber;
  const paddedNumber = String(nextNumber).padStart(6, '0');
  return `${type}${paddedNumber}`;
}
