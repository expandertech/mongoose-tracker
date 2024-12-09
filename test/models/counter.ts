import mongoose, { Schema } from "mongoose";
import { Collections } from "../enums/collection"; 



const CounterSchema = new Schema({
  type: { type: String, enum: ['PD', 'PO', 'EX'], required: true },
  lastNumber: { type: Number, default: 0 },
},
{
  _id: false,
});

const CounterModel = mongoose.model(Collections.Counter, CounterSchema);

export default CounterModel;