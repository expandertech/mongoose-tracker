# mongooseTracker

**mongooseTracker** is a versatile Mongoose plugin that automatically tracks the creation and updates of your documents. It meticulously logs changes to specified fields, including nested fields, arrays, and references to other documents, providing a comprehensive history of modifications. This plugin enhances data integrity and auditability within your MongoDB collections.

Inspired by the [mongoose-trackable](https://www.npmjs.com/package/@folhomee-public/mongoose-tracker) package, **mongooseTracker** offers improved functionality and customization to seamlessly integrate with your Mongoose schemas.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Plugin Configuration](#plugin-configuration)
  - [Options](#options)
  - [Example Schema Usage](#example-schema-usage)
  - [Tracking Changes from Query Middleware](#tracking-changes-from-query-middleware)
- [Example History Output](#example-history-output)
- [Caveats / Notes](#caveats--notes)

---

## Features

- Tracks changes to fields in your Mongoose documents.
- Supports nested objects.
- Supports array elements (detecting added/removed items).
- Supports references (`ObjectId`) to other Mongoose documents (will store a “display” value if available).
- Allows ignoring certain fields (e.g. `_id`, `__v`, etc.).
- Keeps a configurable maximum length of history entries.

---
## Installation

Install **mongooseTracker** via npm:

```bash
npm install @expander/mongoose-tracker
```

OR

```
yarn add @expander/mongoose-tracker
```

---
## Usage

### Plugin Configuration

```js
import mongoose, { Schema } from "mongoose";
import mongooseTracker from "@expander/mongoose-tracker"; // Adjust import based on your actual package name

const YourSchema = new Schema({
  title: String,
  // ...other fields...
});

// Apply the plugin with options
YourSchema.plugin(mongooseTracker, {
  name: "history",
  fieldsToTrack: [
    "title",
    "array.$.array2.$.field",
    "Object.someNestedField",
    "contacts.$.name",
    "orders.$.price",
  ],
  fieldsNotToTrack: ["history", "_id", "__v", "createdAt", "updatedAt"],
  limit: 50,
  instanceMongoose: mongoose, //optional.
});

export default mongoose.model("YourModel", YourSchema);
```

#### What It Does

1. **Adds a History Field**: Adds a field called `history` (by default) to your schema, storing the history of changes.

2. **Monitors Document Changes**: Monitors changes during `save` operations and on specific query-based updates (`findOneAndUpdate`, `updateOne`, `updateMany`).

   > **Note**: Currently, the plugin works best with the `save` method for tracking changes. We are actively working on enhancing support for other update hooks to ensure comprehensive change tracking across all update operations.

3. **Logs Detailed Changes**: Logs an entry each time changes occur, storing the user/system who made the change (`changedBy`) if provided.


### Options

| Option                 | Type       | Default                                                                              | Description                                                                                                   |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **`name`**             | `string`   | `'history'`                                                                          | The name of the array field in which the history records will be stored.                                      |
| **`fieldsToTrack`**    | `string[]` | `[]` (empty)                                                                         | A list of field patterns to track. If empty, **all fields** (except those in `fieldsNotToTrack`) are tracked. |
| **`fieldsNotToTrack`** | `string[]` | `['history', '_id', '_v', '__v', 'createdAt', 'updatedAt', 'deletedAt', '_display']` | Fields/paths to **exclude** from tracking.                                                                    |
| **`limit`**            | `number`   | `50`                                                                                 | Maximum number of history entries to keep in the history array.                                               |
| **`instanceMongoose`** | `mongoose` | The default imported `mongoose` instance                                             | Override if you have a separate Mongoose instance.                                                            |

#### Field Patterns

- A **dot** (`.`) matches subfields.
  - e.g. `user.address.city` tracks changes to the `city` field inside `user.address`.
- A **dollar** sign (`$`) matches “any array index.”
  - e.g. `contacts.$.phone` tracks changes to the `phone` field for **any** element in the `contacts` array.

## Usage

Use as you would any Mongoose plugin :

```js
const mongoose = require("mongoose");
const mongooseTracker = require("@expander/mongoose-tracker");

const { Schema } = mongoose.Schema;

const CarsSchema = new Schema({
  tags: [String],
  description: String,
  price: { type: Number, default: 0 },
});

CarsSchema.plugin(mongooseTracker, {
  limit: 50,
  name: "metaDescriptions",
  fieldsToTrack: ["price", "description"],
});

module.exports = mongoose.model("Cars", CarsSchema);
```

## Caveats / Notes

### Importance of the `_display` Field

The `_display` field is crucial for enhancing the readability of history logs. Instead of logging raw field paths with array indices (e.g., `orders.0.items.1.price`), the plugin utilizes the `_display` field from the respective object to present a more meaningful identifier.

#### How It Works

1. **Presence of `_display`:**

   - Ensure that each subdocument (e.g., items within orders) includes a `_display` field.
   - This field should contain a string value that uniquely identifies the object, such as a name or a readable label.

2. **Concatenation Mechanism:**

   - When a tracked field is updated (e.g., `orders.$.items.$.price`), the plugin retrieves the `_display` value of the corresponding item.
   - It then concatenates this `_display` value with the changed field name to form a readable string for the history log.
   - **Example:**
     - **Raw Field Path:** `orders.0.items.1.price`
     - **With `_display`:** `"Test Item 2 price"`

3. **Handling ObjectId References:**
   - If the `_display` field contains an `ObjectId` referencing another document, the plugin will traverse the reference to fetch the `_display` value of the parent document.
   - This recursive resolution continues until a string value is obtained, ensuring that the history log remains informative.

#### Benefits

- **Clarity:** Provides a clear and concise representation of changes, making it easier to understand what was modified.
- **Readability:** Avoids confusion that can arise from array indices, especially in documents with multiple nested arrays.
- **Relevance:** Focuses on meaningful identifiers that are significant within the application's context.

### Tracking Array Fields

When specifying an array field in `fieldsToTrack`, such as `"orders"`, **mongooseTracker** will monitor for any additions or deletions within that array. This means that:

- **Additions**: When a new element is added to the array, the plugin logs this change in the `history` array.
- **Deletions**: When an existing element is removed from the array, the plugin logs this removal in the `history` array.


## Example

Consider the following schema snippet and operations:

```typescript
interface Item extends Document {
  name: string;
  price: number;
  _display: string;
}

const ItemSchema = new Schema<Item>({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  _display: { type: String, required: true },
});

interface Order extends Document {
  orderNumber: string;
  date: Date;
  items: Item[];
}

const OrderSchema = new Schema<Order>({
  orderNumber: { type: String, required: true, unique: true },
  date: { type: Date, required: true, default: Date.now },
  items: { type: [ItemSchema], required: true },
  _display: {type: String },
});

interface PurchaseDemand extends Document {
  pdNumber: string;
  orders: Order[];
  history?: any[];
}

const PurchaseDemandSchema = new Schema<PurchaseDemand>({
  pdNumber: { type: String, required: true, unique: true },
  orders: [OrderSchema],
});

PurchaseDemandSchema.plugin(mongooseTracker, {
  name: "history",
  fieldsToTrack: ["orders"],
  fieldsNotToTrack: ["history", "_id", "__v"],
  limit: 50,
  instanceMongoose: mongoose,
});

const PurchaseDemandModel = mongoose.model<PurchaseDemand>(
  "PurchaseDemand",
  PurchaseDemandSchema
);
```

### Operations:

Adding an Order:

```js
const purchaseDemand = await PurchaseDemandModel.create({
  pdNumber: "PD-TEST-002",
  orders: [],
});

// Adding a new order
purchaseDemand.orders.push({
  orderNumber: "ORD-TEST-002",
  date: new Date(),
  items: [{ name: "Test Item 3", price: 300, _display: "Test Item 3" }],
  _display: "ORD-TEST-002",
});

await purchaseDemand.save();
```

### History Log Entry After Addition:

```js
{
  "action": "added",
  "at": 1734955271622,
  "changedBy": null,
  "changes": [
    {
      "field": "orders",
      "before": null,
      "after": 'ORD-TEST-002' // the name of _display.
    }
  ]
}

```

### Removing an Order:

```js

purchaseDemand.orders.pop(); // we remove the last element that insert in orders. (ORD-TEST-002)
await purchaseDemand.save();

```
### History Log Entry After Removal:

```js
{
  "action": "removed",
  "at": 1734955271622,
  "changedBy": null,
  "changes": [
    {
      "field": "orders",
      "before": 'ORD-TEST-002'
      "after": null
    }
  ]
}

```

## Contributing

- Use eslint to lint your code.
- Add tests for any new or changed functionality.
- Update the readme with an example if you add or change any functionality.

## Legal

- Author: Roni Jack Vituli
- License: Apache-2.0
