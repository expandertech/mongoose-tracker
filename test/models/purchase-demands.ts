import mongoose, { Schema } from "mongoose";
import { Collections } from "../enums/collection";
import { getNextSerialNumber } from "../functions/getNextSerialNumber";

const PurchaseDemandSchema = new Schema(
  {
    brandId: { type: Schema.Types.ObjectId, ref: Collections.Brand, required: true },
    marketplaceId: { type: Schema.Types.ObjectId, ref: Collections.Marketplace, required: true },
    pdNumber: { type: String, required: true, unique: true },
    active: { type: Boolean, required: true, default: true },
    status: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: Collections.User, required: true },
    approvers: [
      {
        userId: { type: Schema.Types.ObjectId, ref: Collections.User, required: true },
        isApproved: { type: Boolean, required: true, default: false },
        timestamp: { type: Date, default: null }, // Date when the approver approved/rejected the PD
      },
    ],
    products: [
      {
        instanceId: { type: Schema.Types.ObjectId, ref: Collections.ProductInstance, required: true },
        supplierId: { type: Schema.Types.ObjectId, ref: Collections.BusinessPartner, required: true },
        quantity: { type: Number, required: true },
        poRef: { type: Schema.Types.ObjectId, ref: Collections.PurchaseOrders, default: null },
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);


// Pre-save middleware to assign pdNumber
PurchaseDemandSchema.pre('save', async function (next) {
  console.log('Pre-save middleware to assign pdNumber');
  if (this.isNew && !this.pdNumber) {
    try {
      console.log('pdNumber not set. Generating a new pdNumber...');
      // Call the reusable function to get the next serial number for PD
      this.pdNumber = await getNextSerialNumber('PD'); // 'PD' is passed as the type
      await this.validate();
      next();
    } catch (error: any) {
      next(error); // Handle any errors that occur
    }
  } else {
    next(); // If pdNumber is already set, just continue
  }
});


PurchaseDemandSchema.post('save', async function (error: any, doc: any, next: any) {
  console.log('Post-save middleware to handle duplicate key error');
  // Check if the error is a duplicate key error related to `pdNumber`
  if (error.name === 'MongoError' && error.code === 11000 && error.keyValue.pdNumber) {
    try {
      console.log('Duplicate pdNumber error detected. Retrying with a new pdNumber...');

      // Generate a new pdNumber by incrementing the serial number
      doc.pdNumber = await getNextSerialNumber('PD');

      // Attempt to save the document again
      await doc.save();

      next(); // Continue after successful save
    } catch (retryError) {
      next(retryError); // Pass any retry errors to the next middleware
    }
  } else {
    next(error); // If it's not a duplicate key error, pass the error along
  }
});


// Indexes
PurchaseDemandSchema.index({ 'products.instanceId': 1 });
PurchaseDemandSchema.index({ 'products.supplierId': 1 });
PurchaseDemandSchema.index({ '_id':1, 'products.instanceId': 1, "products.supplierId": 1}, {unique: true});


export default PurchaseDemandSchema;