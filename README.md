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
  - [Using _changedBy to Record Changes](#using-_changedby-to-record-changes)
  - [Importance of the _display Field](#importance-of-the-_display-field)
  - [Tracking Array Fields](#tracking-array-fields)
- [Contributing](#contributing)
- [Legal](#legal)

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
  orders: [
    {
      orderId: String,
      timestamp: Date,
      items: [ { name: String, price:Number, .... }, ],
      // ...other fields...
    }
  ],
  user: {
    firstName: String,
    lastName:String,
    // ...other fields...
  }
  // ...other fields...
});

// Apply the plugin with options
YourSchema.plugin(mongooseTracker, {
  name: "history",
  fieldsToTrack: [
    "title",
    "user.firstName",
    "user.lastName",
    "orders.$.items.$.price",
    "orders.$.items.$.name",
    "orders.$.timestamp",
  ],
  fieldsNotToTrack: ["history", "_id", "__v", "createdAt", "updatedAt"],
  limit: 50,
  instanceMongoose: mongoose, //optional.
  logLevel: 'info', // Optional: 'debug' | 'info' | 'warn' | 'error' | 'none' (default: 'none')
});

export default mongoose.model("YourModel", YourSchema);
```

#### What It Does

1. **Adds a History Field**: Adds a field called `history` (by default) to your schema, storing the history of changes.

2. **Monitors Document Changes**: Monitors changes during `save` operations and on specific query-based updates (`findOneAndUpdate`, `updateOne`, `updateMany`).

   > **Note**: Currently, the plugin works best with the `save` method for tracking changes. We are actively working on enhancing support for other update hooks to ensure comprehensive change tracking across all update operations.

3. **Logs Detailed Changes**: Logs an entry each time changes occur, storing the user/system who made the change (`_changedBy`) if provided.

### Options

| Option                 | Type       | Default                                                                              | Description                                                                                                   |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **`name`**             | `string`   | `'history'`                                                                          | The name of the array field in which the history records will be stored.                                      |
| **`fieldsToTrack`**    | `string[]` | `[]` (empty)                                                                         | A list of field patterns to track. If empty, **all fields** (except those in `fieldsNotToTrack`) are tracked. |
| **`fieldsNotToTrack`** | `string[]` | `['history', '_id', '_v', '__v', 'createdAt', 'updatedAt', 'deletedAt', '_display']` | Fields/paths to **exclude** from tracking.                                                                    |
| **`limit`**            | `number`   | `50`                                                                                 | Maximum number of history entries to keep in the history array.                                               |
| **`instanceMongoose`** | `mongoose` | The default imported `mongoose` instance                                             | Override if you have a separate Mongoose instance.                                                            |
| **`logLevel`**         | `string`   | `'none'`                                                                            | Logging level: `'debug'`, `'info'`, `'warn'`, `'error'`, or `'none'`.                                        |
| **`logger`**           | `Logger`   | Default console logger                                                               | Custom logger instance (e.g., Winston, Pino).                                                                 |

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

---

### Using `_changedBy` to Record Changes

The `_changedBy` field allows tracking who made specific changes to a document.
<br/> You can set this field directly before updating a document. <br/>
It's recommended to use a **user ID**, but any string value can be assigned.

#### Example

```js
async function foo() {
  // Create a new document
  const doc = await SomeModel.find({ name: "Initial Name" });
  doc.name = "New Name";
  // Set the user or system responsible for the creation
  doc._changedBy = "creator"; // Replace 'creator' with the user's ID or identifier
  await doc.save();
}
```

#### Resulting History Log

```js
[
  {
    action: "updated",
    at: 1734955271622,
    changedBy: "creator",
    changes: [
      {
        field: "name",
        before: "Initial Name",
        after: "New Name",
      },
    ],
  },
];
```

### Key Notes

- The \_changedBy field is optional but highly recommended for accountability.

- You can dynamically set \_changedBy based on the current user's ID, username, or other unique identifiers.

---

## Importance of the `_display` Field

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

## Example
- Consider the following schema snippet:

```ts
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
  _display:string;
}

const OrderSchema = new Schema<Order>({
  orderNumber: { type: String, required: true, unique: true },
  date: { type: Date, required: true, default: Date.now },
  items: { type: [ItemSchema], required: true },
  _display: { type: String },
});

interface PurchaseDemand extends Document {
  pdNumber: string;
  orders: Order[];
}

const PurchaseDemandSchema = new Schema<PurchaseDemand>({
  pdNumber: { type: String, required: true, unique: true },
  orders: [OrderSchema],
});

PurchaseDemandSchema.plugin(mongooseTracker, {
  fieldsToTrack: ["orders.$.date", "orders.$.items.$.price"], //The Fields I want to track.
});

const PurchaseDemandModel = mongoose.model<PurchaseDemand>(
  "PurchaseDemand",
  PurchaseDemandSchema
);
```

```js
const purchaseDemand = new PurchaseDemand({
  pdNumber: "PD-001",
  orders: [
    {
      orderNumber: "ORD-001",
      items: [
        { name: "Test Item 1", price: 100, _display: "Test Item 1" },
        { name: "Test Item 2", price: 200, _display: "Test Item 2" },
      ],
      _display: "Order 1",
    },
  ],
});


// Update an item's price
purchaseDemand._changedBy = 'system';
purchaseDemand.orders[0].items[1].price = 250;
await purchaseDemand.save();
```


#### History Log Entry:
```js
{
  "action": "updated",
  "at": 1734955271622,
  "changedBy": "system",
  "changes": [
    {
      "field": "Test Item 2 price", // instead of "orders.0.items.1.price" 
      "before": 200,
      "after": 250
    }
  ]
}
```
---

## Logging

The plugin includes a built-in logging system to help with debugging and monitoring. You can control the verbosity of logs using the `logLevel` option or provide your own custom logger.

### Using Built-in Logging

```js
YourSchema.plugin(mongooseTracker, {
  name: "history",
  fieldsToTrack: ["title", "status"],
  logLevel: 'info' // Set log level
});
```

**Available Log Levels:**
- `'debug'` - Detailed information for debugging (field changes, array operations, references)
- `'info'` - General informational messages (hooks triggered, history updates)
- `'warn'` - Warning messages (missing documents, null references)
- `'error'` - Error messages (invalid patterns, lookup failures)
- `'none'` - Disable all logging (default)

### Log Output Examples

```bash
# Info level
[mongoose-tracker] [INFO] Initializing mongoose-tracker plugin with options: { ... }
[mongoose-tracker] [INFO] Pre-save hook triggered for document 507f1f77bcf86cd799439011

# Debug level (includes all info + detailed tracking)
[mongoose-tracker] [DEBUG] Tracking changes for path: title, displayField: title
[mongoose-tracker] [DEBUG] Primitive value changed for title: "Old Title" => "New Title"
[mongoose-tracker] [DEBUG] Array elements added to orders: 2

# Warn level
[mongoose-tracker] [WARN] Referenced document not found for model: Category, id: 507f1f77bcf86cd799439012
```

### Using a Custom Logger

You can provide your own logger (e.g., Winston, Pino) by implementing the `Logger` interface:

```js
import winston from 'winston';

const customLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'mongoose-tracker.log' })
  ]
});

// Adapt Winston to mongoose-tracker Logger interface
const loggerAdapter = {
  debug: (message, ...args) => customLogger.debug(message, args),
  info: (message, ...args) => customLogger.info(message, args),
  warn: (message, ...args) => customLogger.warn(message, args),
  error: (message, ...args) => customLogger.error(message, args)
};

YourSchema.plugin(mongooseTracker, {
  name: "history",
  fieldsToTrack: ["title"],
  logger: loggerAdapter
});
```

### Using Pino

```js
import pino from 'pino';

const pinoLogger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty'
  }
});

const loggerAdapter = {
  debug: (message, ...args) => pinoLogger.debug({ args }, message),
  info: (message, ...args) => pinoLogger.info({ args }, message),
  warn: (message, ...args) => pinoLogger.warn({ args }, message),
  error: (message, ...args) => pinoLogger.error({ args }, message)
};

YourSchema.plugin(mongooseTracker, {
  name: "history",
  logger: loggerAdapter
});
```

## Tracking Array Fields

When specifying an array field in fieldsToTrack, such as "orders", **mongooseTracker** will monitor for any additions or deletions within that array. This means that:

- **Additions**: When a new element is added to the array, the plugin logs this change in the history array.
- **Deletions**: When an existing element is removed from the array, the plugin logs this removal in the history array.

#### Operations:
Adding an element (Order):

```js

PurchaseDemandSchema.plugin(mongooseTracker, {
  fieldsToTrack: ["orders"],
});


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

#### History Log Entry After Addition:

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
#### Removing an element (Order):

```js
purchaseDemand.orders.pop(); // we remove the last element that insert in orders. (ORD-TEST-002)
await purchaseDemand.save();
```
#### History Log Entry After Removal:
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
