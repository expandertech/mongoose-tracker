# mongooseTracker

Mongoose Tracker is a mongoose plugin that automatically keeps track of when the document has been created & updated. Rewrite from old [mongoose-trackable]('https://www.npmjs.com/package/@folhomee-public/mongoose-tracker').

A **Mongoose** plugin for tracking document history (create/update actions).  
Tracks field changes, including nested fields, arrays, and references to other documents.

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

```bash
npm install mongoose-tracker
```

---
## Usage
### Plugin Configuration
```js
import mongoose, { Schema } from 'mongoose';
import mongooseTracker from 'mongoose-tracker'; // Adjust import based on your actual package name

const YourSchema = new Schema({
  title: String,
  // ...other fields...
});

// Apply the plugin with options
YourSchema.plugin(mongooseTracker, {
  name: 'history',
  fieldsToTrack: ['title', 'Object.someNestedField', 'contacts.$.name', 'orders.$.price'],
  fieldsNotToTrack: ['history', '_id', '__v', 'createdAt', 'updatedAt'],
  limit: 50,
  instanceMongoose: mongoose,
});

export default mongoose.model('YourModel', YourSchema);
```
#### What It Does
1. Adds a field called history (by default) to your schema, storing the history of changes.
2. Monitors changes on save and on specific queries (findOneAndUpdate, updateOne, updateMany).
3. Logs an entry each time changes occur, storing the user/system who made the change (changedBy) if provided.

### Options

| Option                 | Type      | Default                                                          | Description                                                                                                                      |
|------------------------|-----------|------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| **`name`**            | `string`  | `'history'`                                                      | The name of the array field in which the history records will be stored.                                                         |
| **`fieldsToTrack`**   | `string[]`| `[]` (empty)                                                     | A list of field patterns to track. If empty, **all fields** (except those in `fieldsNotToTrack`) are tracked.                    |
| **`fieldsNotToTrack`**| `string[]`| `['history', '_id', '_v', '__v', 'createdAt', 'updatedAt', 'deletedAt', '_display']` | Fields/paths to **exclude** from tracking.                                                                                       |
| **`limit`**           | `number`  | `50`                                                             | Maximum number of history entries to keep in the history array.                                                                  |
| **`instanceMongoose`**| `mongoose`| The default imported `mongoose` instance                         | Override if you have a separate Mongoose instance.                                                                               |

#### Field Patterns

- A **dot** (`.`) matches subfields.  
  - e.g. `user.address.city` tracks changes to the `city` field inside `user.address`.
- A **dollar** sign (`$`) matches “any array index.”  
  - e.g. `contacts.$.phone` tracks changes to the `phone` field for **any** element in the `contacts` array.


## Usage

Use as you would any Mongoose plugin :

```js
const mongoose = require('mongoose')
const mongooseTracker = require('@folhomee-public/mongoose-tracker')

const { Schema } = mongoose.Schema

const CarsSchema = new Schema({
    tags: [String],
    description: String,
    price: { type: Number, default: 0 },
})

CarsSchema.plugin(mongooseTracker, {
    limit: 50,
    name: 'metaDescriptions',
    fieldsToTrack: ['price', 'description'],
})

module.exports = mongoose.model('Cars', CarsSchema)
```

When create/update is successful, a [**History**](#History) element is pushed to __updates or the named Array

### Example Schema Usage

```ts
import mongoose, { Schema, Document } from 'mongoose';
import mongooseTracker from 'mongoose-tracker'; // Adjust import path

interface IUser extends Document {
  name: string;
  email: string;
  friends: mongoose.Types.ObjectId[];
  history?: any[]; // 'history' is the default field where changes are stored
}

const UserSchema = new Schema<IUser>({
  name: String,
  email: String,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});

// Apply plugin with desired options
UserSchema.plugin(mongooseTracker, {
  fieldsToTrack: ['name', 'email', 'friends.$'],
  // fieldsNotToTrack, limit, etc. can be defined here
});

export const User = mongoose.model<IUser>('User', UserSchema);

```

## Example History Output

Below is an example of what the `history` array might look like after a few updates:

```json
[
  {
    "action": "updated",
    "at": 1678239645000,
    "changedBy": "user-xyz",
    "changes": [
      {
        "field": "name",
        "before": "Old Name",
        "after": "New Name"
      },
      {
        "field": "friends",
        "before": ["602c0c6c8cef5b4a40c3a97f"],
        "after": ["602c0c6c8cef5b4a40c3a97f", "5ebd9ac90a4b642f1c6b7755"]
      }
    ]
  },
  {
    "action": "removed",
    "at": 1678239700000,
    "changedBy": "system-cronjob",
    "changes": [
      {
        "field": "friends",
        "before": "602c0c6c8cef5b4a40c3a97f",
        "after": null
      }
    ]
  }
]
```

### Caveats / Notes
1. Performance: Tracking many fields or very large arrays can be expensive. Use patterns ($) and fieldsToTrack wisely.
2. Array Comparison: The plugin considers array items by value using lodash.isEqual, which can be expensive for large nested objects.
3. References: If a field is a reference to another document (ObjectId with a ref), the plugin attempts to store a “display” value if available (_display by default, or name).
4. History Limit: The plugin enforces a limit on how many history entries are stored (default 50). Older entries are dropped once the limit is exceeded.

## Contributing

- Use eslint to lint your code.
- Add tests for any new or changed functionality.
- Update the readme with an example if you add or change any functionality.

## Legal

Author: Roni Jack Vituli, License Apache-2.0