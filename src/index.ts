import mongoose, { MongooseDefaultQueryMiddleware, Schema } from "mongoose";
import { get, isNull, takeRight, isEmpty, isObject, isArray } from "lodash";
import { Options, History, Change } from "./interfaces";

function isValidObjectId(id: any): boolean {
  if (mongoose.Types.ObjectId.isValid(id)) {
    if (String(new mongoose.Types.ObjectId(id)) === id.toString()) {
      return true;
    }
    return false;
  }
  return false;
}

function matchPattern(fieldPath: string, pattern: string): boolean {
  // Convert the pattern to a regex
  const regexPattern = pattern.replace(/\$/g, "\\d+"); // Replace $ with \d+ (matches any digit)
  const regex = new RegExp(`^${regexPattern}$`); // Add anchors to match the entire string

  return regex.test(fieldPath); // Test if the fieldPath matches the regex
}

const mongooseTracker = function (schema: Schema, options: Options): void {
  const {
    name = "history",
    fieldsToTrack = [],
    fieldsNotToTrack = ["history", "_id", "_v", "__v", "createdAt", "updatedAt", "deletedAt"],
    limit = 50,
    instnaceMongoose = mongoose,
  } = options;

  schema.add({
    [name]: Array,
  });

  // Helper: Recursively track changes in nested fields or arrays
  const trackChanges = (doc: any, path: string, value: any, changes: Change[]): void => {
    if (isObject(value) && !isArray(value)) {
      const isMongooseDoc =
        typeof (value as any).toObject === "function" &&
        (value.constructor?.name === "model" ||
          value instanceof mongoose.Document);

      const plainObject = isMongooseDoc ? (value as any).toObject() : value;
      // Recursively track changes in the object
      Object.entries(plainObject).forEach(([key, subValue]) => {
        trackChanges(doc, `${path}.${key}`, subValue, changes);
      });
    } else if (isArray(value)) {
      // If it's an array, iterate through the elements
      const arrayToIterate = value
        .map((item: any) =>
          typeof item.toObject === "function" ? item.toObject() : item
        )
        .map(({ _id, ...reset }) => reset);

      arrayToIterate.forEach((element, index) => {
        trackChanges(doc, `${path}[${index}]`, element, changes);
      });
    } else {
      // Track primitive values
      if (get(doc, path) !== value) {
        changes.push({
          field: path,
          before: get(doc, path),
          after: value,
        });
      }
    }
  };

  // Determine if a field should be tracked
  const shouldTrackField = (field: string): boolean => {
    // Check if the field is explicitly excluded
    if (
      fieldsNotToTrack.some((notTrackedField) =>
        field.startsWith(notTrackedField)
      )
    ) {
      return false;
    }

    // If no specific fields are specified to track, track all fields
    if (isEmpty(fieldsToTrack)) {
      return true;
    }

    // Check if the field matches any of the tracked fields
    return fieldsToTrack.some((trackedField) =>
      matchPattern(field, trackedField)
    );
  };

  // Pre-save hook to track changes
  schema.pre("save", async function (next) {
    console.log(`Pre-save middleware ${this.isNew} mongooseTracker`);

    if (this.isNew) {
      console.log(`PRE-SAVE the doc is new ${this._id}`);
      return;
    }

    const changedBy = (this._changedBy as string) ?? null;
    console.log(`changedBy: ${changedBy}`);

    const history: History = {
      action: "updated",
      at: Date.now(),
      changedBy: changedBy,
      changes: [],
    };
    const allHistory = this.get(`${name}`) as History[];

    const updatedFields = this.directModifiedPaths();

    const oldDoc = await (this.constructor as any).findById(this.id);
    if (!oldDoc) {
      return;
    }

    for (const field of updatedFields) {
      if (!shouldTrackField(field)) continue;
      const value = get(this, field);
      if (isValidObjectId(value) || isValidObjectId(get(oldDoc, field))) {
        const refModel = (this as any).schema.path(field)?.options?.ref;
        if (refModel) {
          const modelDoc = await instnaceMongoose.model(refModel).findById(value);
          const oldValue = await instnaceMongoose.model(refModel).findById(get(oldDoc, field));
          history.changes.push({
            field,
            before: oldValue?.name ?? get(oldDoc, field),
            after: modelDoc?.name ?? value,
          });
          continue;
        }
      } else {
        trackChanges(oldDoc, field, value, history.changes);
      }
    }

    // updatedFields.forEach(async (field) => {
    //   if (shouldTrackField(field)) {
    //     const value = get(this, field);
    //     if (isValidObjectId(value)) {
    //       const refModel = (this as any).schema.path(field)?.options?.ref;
    //       if (refModel) {
    //         const modelDoc = await instnaceMongoose
    //           .model(refModel)
    //           .findById(value);
    //         trackChanges(this, field, modelDoc?.name || value, history.changes);
    //       }
    //     } else {
    //       trackChanges(oldDoc, field, value, history.changes);
    //     }
    //   }
    // });

    // Enforce history limit in the pre-save hook
    const updatedHistory = takeRight([...allHistory, history], limit);
    this.set(`${name}`, updatedHistory);

    next();
  });

  // Middleware hooks for query-based updates
  const hooks: MongooseDefaultQueryMiddleware[] = [
    "findOneAndUpdate",
    "updateOne",
    "updateMany",
  ];

  schema.pre(hooks, async function (next) {
    console.log("Pre-hook middleware mongooseTracker");
    const updatedFields = this.getUpdate();
    const { changedBy, skipMiddleware } = this.getOptions();

    if (skipMiddleware) {
      return next();
    }

    if (isNull(updatedFields)) {
      return;
    }
    const originalDoc = await this.model.findOne(this.getQuery());

    if (isNull(originalDoc)) {
      return;
    }

    const history: History = {
      action: "updated",
      at: Date.now(),
      changedBy: changedBy || "",
      changes: [],
    };

    // Iterate over updated fields
    for (const [key, value] of Object.entries(updatedFields)) {
      if (shouldTrackField(key)) {
        if (isValidObjectId(value) || isValidObjectId(get(originalDoc, key))) {
          const refModel = (this as any).schema.path(key)?.options?.ref;
          if (refModel) {
            const modelDoc = await instnaceMongoose.model(refModel).findById(value);
            const oldValue = await instnaceMongoose.model(refModel).findById(get(originalDoc, key));
            history.changes.push({
              field: key,
              before: oldValue?.name ?? get(originalDoc, key),
              after: modelDoc?.name ?? value,
            });
            continue;
          }
        } else {
          trackChanges(originalDoc, key, value, history.changes);
        }
      }
    }

    if (isEmpty(history.changes)) {
      return;
    }

    const docUpdated = await this.model.findOne(this.getQuery());

    if (isNull(docUpdated)) {
      return;
    }

    const oldHistory = docUpdated.get(`${name}`) || [];

    await this.model.updateOne(
      this.getQuery(),
      { [name]: takeRight([...oldHistory, history], limit) },
      { skipMiddleware: true }
    );
  });
};

export default mongooseTracker;
