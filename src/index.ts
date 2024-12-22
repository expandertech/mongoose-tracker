import mongoose, { MongooseDefaultQueryMiddleware, Schema, Types } from 'mongoose'
import { get, isNull, takeRight, isEmpty, isObject, isArray, isEqual, isDate } from 'lodash'
import { Options, History } from './interfaces'

function isValidObjectId (id: any): boolean {
  if (mongoose.Types.ObjectId.isValid(id)) {
    if (String(new mongoose.Types.ObjectId(id)) === id.toString()) {
      return true
    }
    return false
  }
  return false
}

function matchPattern (fieldPath: string, pattern: string): boolean {
  // Convert the pattern to a regex
  const regexPattern = pattern.replace(/\$/g, '\\d+') // Replace $ with \d+ (matches any digit)
  const regex = new RegExp(`^${regexPattern}$`) // Add anchors to match the entire string

  return regex.test(fieldPath) // Test if the fieldPath matches the regex
}

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

  const returnDisplayFromDocument = async (doc: any, field: string, value: any): Promise<any> => {
    if (isValidObjectId(value)) {
      const refModel = doc.schema.path(field)?.options?.ref
      if (!isNull(refModel)) {
        console.log('refModel', refModel)
        const modelDoc = await instanceMongoose.model(refModel).findById(new Types.ObjectId(value as string))
        return await returnDisplayFromDocument(modelDoc, '_display', modelDoc.toObject()._display)
      }
    }
    return value
  }

  const trackChanges = async (doc: any, path: string, value: any, history: History): Promise<void> => {
    if (isObject(value) && !isArray(value) && !isDate(value)) {
      const isMongooseDoc =
        typeof (value as any).toObject === 'function' &&
        (value.constructor?.name === 'model' || value instanceof mongoose.Document)
      const plainObject = isMongooseDoc ? (value as any).toObject() : value
      await Promise.all(
        Object.entries(plainObject).map(async ([key, subValue]) => {
          if (!fieldsNotToTrack.includes(key)) {
            await trackChanges(doc, `${path}.${key}`, subValue, history)
          }
        })
      )
    } else if (isArray(value)) {
      const oldArray: any[] = get(doc, path) ?? []
      const newArray: any[] = value ?? []
      const { added, removed } = findArrayDifferences(oldArray, newArray)
      if (removed.length > 0) {
        history.action = 'removed'
        await Promise.all(
          removed.map(async (element, index) => {
            if (isObject(element) && !isArray(element)) {
              const display = await returnDisplayFromDocument(doc, `${path}.${index}._display`, (element as any)._display)
              history.changes.push({
                field: path,
                before: display,
                after: null
              })
            } else {
              history.changes.push({
                field: path,
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
              const display = await returnDisplayFromDocument(doc, `${path}.${index}._display`, (element as any)._display)
              history.changes.push({
                field: path,
                before: null,
                after: display
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
          field: path,
          before: get(doc, path) ?? null,
          after: value ?? null
        })
      } else if (history.action === 'removed') {
        history.changes.push({
          field: path,
          before: get(doc, path) ?? null,
          after: null
        })
      }
    }
  }

  // Determine if a field should be tracked
  const shouldTrackField = (field: string): boolean => {
    // Check if the field is explicitly excluded
    if (
      fieldsNotToTrack.some((notTrackedField) =>
        field.startsWith(notTrackedField)
      )
    ) {
      return false
    }

    // If no specific fields are specified to track, track all fields
    if (isEmpty(fieldsToTrack)) {
      return true
    }

    // Check if the field matches any of the tracked fields
    return fieldsToTrack.some((trackedField) =>
      matchPattern(field, trackedField)
    )
  }

  // Pre-save hook to track changes
  schema.pre('save', async function (next) {
    if (this.isNew) {
      return
    }

    const changedBy = (this._changedBy as string) ?? null
    console.log(`changedBy: ${changedBy}`)

    const history: History = {
      action: 'updated',
      at: Date.now(),
      changedBy: changedBy,
      changes: []
    }
    const allHistory = this.get(`${name}`) as History[]

    const updatedFields = this.directModifiedPaths()

    console.log('updatedFields', updatedFields)

    const oldDoc = await (this.constructor as any).findById(this.id)
    if (isNull(oldDoc)) {
      return
    }

    for (const field of updatedFields) {
      if (!shouldTrackField(field)) continue
      const value = get(this, field)
      if (isValidObjectId(value) || isValidObjectId(get(oldDoc, field))) {
        const refModel = (this as any).schema.path(field)?.options?.ref
        if (!isNull(refModel)) {
          console.log('refModel', refModel)
          const modelDoc = await instanceMongoose.model(refModel).findById(new Types.ObjectId(value as string))
          const oldValue = await instanceMongoose.model(refModel).findById(new Types.ObjectId(get(oldDoc, field)))
          history.changes.push({
            field,
            before: oldValue?.toObject()?._display ?? get(oldDoc, field),
            after: modelDoc?.toObject()?._display ?? value
          })
          continue
        }
      } else {
        await trackChanges(oldDoc, field, value, history)
      }
    }

    if (isEmpty(history.changes)) {
      return
    }
    // Enforce history limit in the pre-save hook
    const updatedHistory = takeRight([...allHistory, history], limit)
    this.set(`${name}`, updatedHistory)

    next()
  })

  // Middleware hooks for query-based updates
  const hooks: MongooseDefaultQueryMiddleware[] = [
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
    for (const [key, value] of Object.entries(updatedFields)) {
      if (shouldTrackField(key)) {
        if (isValidObjectId(value) || isValidObjectId(get(originalDoc, key))) {
          const refModel = (this as any).schema.path(key)?.options?.ref
          if (!isNull(refModel)) {
            console.log('refModel', refModel)
            const modelDoc = await instanceMongoose.model(refModel).findById(value)
            const oldValue = await instanceMongoose.model(refModel).findById(get(originalDoc, key))
            console.log('modelDoc', modelDoc.name)
            console.log('oldValue', oldValue.name)

            history.changes.push({
              field: key,
              before: oldValue?.name ?? get(originalDoc, key),
              after: modelDoc?.name ?? value
            })
            continue
          }
        } else {
          await trackChanges(originalDoc, key, value, history)
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
