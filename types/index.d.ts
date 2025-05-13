import { Schema } from 'mongoose';
import { Options } from './interfaces';
declare const mongooseTracker: (schema: Schema, options: Options) => void;
export default mongooseTracker;
