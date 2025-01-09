import mongoose, { Schema, Types, MongooseQueryMiddleware } from 'mongoose'
import { get, isNull, takeRight, isEmpty, isObject, isArray, isEqual, isDate } from 'lodash'
import { Options, History } from './interfaces'

/**
 * Check if a given value is a valid ObjectId.
 *
 * @param id - The value to verify.
 * @returns `true` if the value is a valid ObjectId, otherwise `false`.
 */
function isObjectIdValid (id: any): boolean {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return String(new mongoose.Types.ObjectId(id)) === id.toString()
  }
  return false
}

/**
 * Check if a given field path matches a given pattern.
 * Example:
 *    pattern = "field.$.subfield"
 *    fieldPath = "field.0.subfield"
 */
function doesFieldNameMatchPattern (fieldPath: string, pattern: string): boolean {
  // Convert the pattern to a regex
  const regexPattern = pattern.replace(/\$/g, '\\d+') // Replace $ with \d+ (matches any digit)
  const regex = new RegExp(`^${regexPattern}$`) // Add anchors to match the entire string

  return regex.test(fieldPath) // Test if the fieldPath matches the regex
}

/**
 * Check if a string can safely be turned into a valid RegExp pattern.
 */
const isValidPattern = (pattern: string): boolean => {
  try {
    RegExp(pattern.replace(/\./g, '\\.').replace(/\$/g, '\\$')) // Replace dots and dollars for regex compatibility
    return true
  } catch (e) {
    return false
  }
}

const findArrayDifferences = (oldArray: any[], newArray: any[]): { added: any[], removed: any[] } => {
  // Find added elements
  const added = newArray.map((item: any) => (typeof item.toObject === 'function' ? item.toObject() : item)).filter(
    (newItem) => !oldArray.map((item: any) => (typeof item.toObject === 'function' ? item.toObject() : item)).some((oldItem) => isEqual(oldItem, newItem))
  )

  // Find removed elements
  const removed = oldArray.map((item: any) => (typeof item.toObject === 'function' ? item.toObject() : item)).filter(
    (oldItem) => !newArray.map((item: any) => (typeof item.toObject === 'function' ? item.toObject() : item)).some((newItem) => isEqual(oldItem, newItem))
  )

  return { added, removed }
}

const getDisplayName = async (doc: any, field: string, mongoose: any): Promise<string> => {
  const parts = field.split('.')
  const isArrayPath = parts.some((part) => /^\d+$/.test(part))
  if (isArrayPath) {
    const path = `${parts.slice(0, parts.length - 1).join('.')}._display`
    const docValue = get(doc, path)
    const displayField = await returnDisplayFromDocumentForField(doc, field, path, docValue, mongoose)
    return displayField === field ? field : `${displayField} ${parts[parts.length - 1]}`
  }
  return field
}

const returnDisplayFromDocumentForValue = async (doc: any, field: string, value: any, mongoose: any): Promise<string> => {
  if (isObjectIdValid(value)) {
    const refModel = doc.schema.path(field)?.options?.ref
    if (!isNull(refModel)) {
      console.log('refModel', refModel)
      const modelDoc = await mongoose.model(refModel).findById(new Types.ObjectId(value as string))
      return await returnDisplayFromDocumentForValue(modelDoc, '_display', modelDoc.toObject()._display, mongoose)
    }
  }
  return value
}

const returnDisplayFromDocumentForField = async (doc: any, originalField: string, field: string, value: any, mongoose: any): Promise<string> => {
  if (isObjectIdValid(value)) {
    const refModel = doc.schema.path(field)?.options?.ref
    if (!isNull(refModel)) {
      console.log('refModel', refModel)
      const modelDoc = await mongoose.model(refModel).findById(new Types.ObjectId(value as string))
      return await returnDisplayFromDocumentForValue(modelDoc, '_display', modelDoc.toObject()._display, mongoose)
    }
  }
  return value ?? originalField
}

const mongooseTracker = function (schema: Schema, options: Options): void {
  const {
    name = 'history',
    fieldsToTrack = [],
    fieldsNotToTrack = ['history', '_id', '_v', '__v', 'createdAt', 'updatedAt', 'deletedAt', '_display'],
    limit = 50,
    instanceMongoose = mongoose
  } = options

  fieldsToTrack.forEach((field) => {
    if (!isValidPattern(field)) {
      throw new Error(`Invalid field pattern: ${field}`)
    }
  })

  schema.add({
    [name]: Array
  })

  const trackChanges = async (doc: any, path: string, value: any, history: History, displayField: string): Promise<void> => {
    if (isObject(value) && !isArray(value) && !isDate(value)) {
      const isMongooseDoc = typeof (value as any).toObject === 'function' && (value.constructor?.name === 'model' || value instanceof mongoose.Document)
      const plainObject = isMongooseDoc ? (value as any).toObject() : value
      if ('_display' in plainObject) {
        const beforeDisplay = get(doc, `${path}._display`) ?? null
        const afterDisplay = plainObject._display ?? null
        const v1 = await returnDisplayFromDocumentForValue(doc, `${path}._display`, beforeDisplay, instanceMongoose)
        const v2 = await returnDisplayFromDocumentForValue(doc, `${path}._display`, afterDisplay, instanceMongoose)
        if (beforeDisplay !== afterDisplay) {
          history.changes.push({
            field: displayField, // Use the displayField for the whole object
            before: v1,
            after: v2
          })
        }
      } else {
        await Promise.all(
          Object.entries(plainObject).map(async ([key, subValue]) => {
            if (!fieldsNotToTrack.includes(key)) {
              await trackChanges(doc, `${path}.${key}`, subValue, history, `${displayField} ${key}`)
            }
          })
        )
      }
    } else if (isArray(value)) {
      const oldArray: any[] = get(doc, path) ?? []
      const newArray: any[] = value ?? []
      const { added, removed } = findArrayDifferences(oldArray, newArray)
      if (removed.length > 0) {
        history.action = 'removed'
        await Promise.all(
          removed.map(async (element: any, index) => {
            if (isObject(element) && !isArray(element)) {
              const valueDisplay = await returnDisplayFromDocumentForValue(doc, `${path}.${index}._display`, (element as any)._display, instanceMongoose)
              history.changes.push({
                field: displayField,
                before: valueDisplay,
                after: null
              })
            } else {
              history.changes.push({
                field: displayField,
                before: element,
                after: null
              })
            }
          })
        )
      } else if (added.length > 0) {
        history.action = 'added'
        await Promise.all(
          added.map(async (element, index) => {
            if (isObject(element) && !isArray(element)) {
              const valueDisplay = await returnDisplayFromDocumentForValue(doc, `${path}.${index}._display`, (element as any)._display, instanceMongoose)
              history.changes.push({
                field: path,
                before: null,
                after: valueDisplay
              })
            } else {
              history.changes.push({
                field: path,
                before: null,
                after: element
              })
            }
          })
        )
      }
    } else {
      // Track primitive values
      if (get(doc, path) !== value) {
        history.changes.push({
          field: displayField,
          before: get(doc, path) ?? null,
          after: value ?? null
        })
      } else if (history.action === 'removed') {
        history.changes.push({
          field: displayField,
          before: get(doc, path) ?? null,
          after: null
        })
      }
    }
  }

  // Determine if a field should be tracked
  const shouldTrackField = (field: string): boolean => {
    // Check if the field is explicitly excluded
    if (fieldsNotToTrack.some((notTrackedField) => field.startsWith(notTrackedField))) {
      return false
    }

    // If no specific fields are specified to track, track all fields
    if (isEmpty(fieldsToTrack)) {
      return true
    }

    // Check if the field matches any of the tracked fields
    return fieldsToTrack.some((trackedField) =>
      doesFieldNameMatchPattern(field, trackedField)
    )
  }

  // Pre-save hook to track changes
  schema.pre('save', async function (next) {
    if (this.isNew) {
      return
    }
    const changedBy = (this._changedBy as string) ?? null
    const history: History = {
      action: 'updated',
      at: Date.now(),
      changedBy: changedBy,
      changes: []
    }
    const currentHistoryRecords = this.get(name) as History[]
    const changedFields = this.directModifiedPaths()

    const docBeforeUpdate = await (this.constructor as any).findById(this.id)
    if (isNull(docBeforeUpdate)) {
      return
    }

    for (const fieldPath of changedFields) {
      if (!shouldTrackField(fieldPath)) continue
      const newValue = get(this, fieldPath)
      const displayField = await getDisplayName(this, fieldPath, instanceMongoose)
      if (isObjectIdValid(newValue) || isObjectIdValid(get(docBeforeUpdate, fieldPath))) {
        const refModel = (this as any).schema.path(fieldPath)?.options?.ref
        if (!isNull(refModel)) {
          const modelDoc = await instanceMongoose.model(refModel).findById(new Types.ObjectId(newValue as string))
          const oldValue = await instanceMongoose.model(refModel).findById(new Types.ObjectId(get(docBeforeUpdate, fieldPath)))
          history.changes.push({
            field: displayField,
            before: oldValue?.toObject()?._display ?? get(docBeforeUpdate, fieldPath),
            after: modelDoc?.toObject()?._display ?? newValue
          })
          continue
        }
      } else {
        await trackChanges(docBeforeUpdate, fieldPath, newValue, history, displayField)
      }
    }

    if (isEmpty(history.changes)) {
      return
    }
    // Enforce history limit in the pre-save hook
    const updatedHistoryRecords = takeRight([...currentHistoryRecords, history], limit)
    this.set(`${name}`, updatedHistoryRecords)

    next()
  })

  // Middleware hooks for query-based updates
  const hooks: MongooseQueryMiddleware[] = [
    'findOneAndUpdate',
    'updateOne',
    'updateMany'
  ]

  schema.pre(hooks, async function (next) {
    console.log('Pre-hook middleware mongooseTracker')
    const updatedFields = this.getUpdate()
    const { changedBy, skipMiddleware } = this.getOptions() as { changedBy: string, skipMiddleware: boolean }

    if (skipMiddleware) {
      return next()
    }

    if (isNull(updatedFields)) {
      return
    }
    const originalDoc = await this.model.findOne(this.getQuery())

    if (isNull(originalDoc)) {
      return
    }

    const history: History = {
      action: 'updated',
      at: Date.now(),
      changedBy: changedBy ?? '',
      changes: []
    }

    // Iterate over updated fields
    for (const [path, value] of Object.entries(updatedFields)) {
      if (shouldTrackField(path)) {
        if (isObjectIdValid(value) || isObjectIdValid(get(originalDoc, path))) {
          const refModel = (this as any).schema.path(path)?.options?.ref
          if (!isNull(refModel)) {
            console.log('refModel', refModel)
            const modelDoc = await instanceMongoose.model(refModel).findById(value)
            const oldValue = await instanceMongoose.model(refModel).findById(get(originalDoc, path))
            console.log('modelDoc', modelDoc.name)
            console.log('oldValue', oldValue.name)

            history.changes.push({
              field: path,
              before: oldValue?.name ?? get(originalDoc, path),
              after: modelDoc?.name ?? value
            })
            continue
          }
        } else {
          await trackChanges(originalDoc, path, value, history, path)
        }
      }
    }

    if (isEmpty(history.changes)) {
      return
    }

    const docUpdated = await this.model.findOne(this.getQuery())

    if (isNull(docUpdated)) {
      return
    }

    const oldHistory = docUpdated.get(`${name}`)
    await this.model.updateOne(
      this.getQuery(),
      { [name]: takeRight([...oldHistory, history], limit) },
      { skipMiddleware: true }
    )
  })
}

export default mongooseTracker
