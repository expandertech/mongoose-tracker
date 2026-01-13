import mongoose, { Schema, Types, MongooseQueryMiddleware } from 'mongoose'
import { get, isNull, takeRight, isEmpty, isObject, isArray, isEqual, isDate, isUndefined } from 'lodash'
import { Options, History, Logger, LogLevel } from './interfaces'

/**
 * Create a default console-based logger with log level filtering
 */
const createDefaultLogger = (logLevel: LogLevel): Logger => {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4
  }

  const currentLevel = levels[logLevel]
  const prefix = '[mongoose-tracker]'

  return {
    debug: (message: string, ...args: any[]) => {
      if (currentLevel <= levels.debug) {
        console.debug(`${prefix} [DEBUG]`, message, ...args)
      }
    },
    info: (message: string, ...args: any[]) => {
      if (currentLevel <= levels.info) {
        console.info(`${prefix} [INFO]`, message, ...args)
      }
    },
    warn: (message: string, ...args: any[]) => {
      if (currentLevel <= levels.warn) {
        console.warn(`${prefix} [WARN]`, message, ...args)
      }
    },
    error: (message: string, ...args: any[]) => {
      if (currentLevel <= levels.error) {
        console.error(`${prefix} [ERROR]`, message, ...args)
      }
    }
  }
}

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
  // Normalize arrays by converting all items to plain objects
  const normalizeItem = (item: any): any => {
    if (typeof item?.toObject === 'function') {
      return item.toObject()
    }
    return item
  }

  const normalizedOldArray = oldArray.map(normalizeItem)
  const normalizedNewArray = newArray.map(normalizeItem)

  // Custom comparison function that handles _id fields
  const itemsEqual = (item1: any, item2: any): boolean => {
    // If both have _id, compare by _id (faster and more reliable)
    if (item1?._id != null && item2?._id != null) {
      return item1._id.toString() === item2._id.toString()
    }
    // Otherwise use deep equality
    return isEqual(item1, item2)
  }

  // Find added elements
  const added = normalizedNewArray.filter(
    (newItem) => !normalizedOldArray.some((oldItem) => itemsEqual(oldItem, newItem))
  )

  // Find removed elements
  const removed = normalizedOldArray.filter(
    (oldItem) => !normalizedNewArray.some((newItem) => itemsEqual(oldItem, newItem))
  )

  return { added, removed }
}

const getDisplayName = async (doc: any, field: string, mongoose: any, logger: Logger): Promise<string> => {
  const parts = field.split('.')
  const isArrayPath = parts.some((part) => /^\d+$/.test(part))

  if (isArrayPath) {
    // Find all array index positions
    const arrayIndices: number[] = []
    parts.forEach((part, index) => {
      if (/^\d+$/.test(part)) {
        arrayIndices.push(index)
      }
    })

    // Try to find _display starting from the innermost array (last index) to outermost
    for (let i = arrayIndices.length - 1; i >= 0; i--) {
      const arrayIndexPosition = arrayIndices[i]
      const path = `${parts.slice(0, arrayIndexPosition + 1).join('.')}._display`
      const docValue = get(doc, path)

      // If _display exists at this level, use it
      if (docValue !== undefined && docValue !== null) {
        const displayField = await returnDisplayFromDocumentForField(doc, field, path, docValue, mongoose, logger)
        return displayField === field ? field : `${displayField} ${parts[parts.length - 1]}`
      }
    }

    // If no _display found, return the original field
    return field
  }
  return field
}

const returnDisplayFromDocumentForValue = async (doc: any, field: string, value: any, mongoose: any, logger: Logger): Promise<string> => {
  if (isObjectIdValid(value)) {
    const refModel = doc.schema.path(field)?.options?.ref
    if (!isNull(refModel)) {
      logger.debug(`Resolving reference for field: ${field}, model: ${refModel}, id: ${value}`)
      const modelDoc = await mongoose.model(refModel).findById(new Types.ObjectId(value as string))
      if (isNull(modelDoc) || isUndefined(modelDoc)) {
        logger.warn(`Referenced document not found for model: ${refModel}, id: ${value}`)
        return value
      }
      logger.debug(`Resolved reference for ${refModel}:`, modelDoc.toObject()._display)
      return await returnDisplayFromDocumentForValue(modelDoc, '_display', modelDoc.toObject()._display, mongoose, logger)
    }
  }
  return value
}

const returnDisplayFromDocumentForField = async (doc: any, originalField: string, field: string, value: any, mongoose: any, logger: Logger): Promise<string> => {
  if (isObjectIdValid(value)) {
    const refModel = doc.schema.path(field)?.options?.ref
    if (!isNull(refModel)) {
      logger.debug(`Resolving field reference: ${field}, model: ${refModel}`)
      const modelDoc = await mongoose.model(refModel).findById(new Types.ObjectId(value as string))
      if (isNull(modelDoc)) {
        logger.warn(`Model document not found for ${refModel}, field: ${field}`)
        return value
      }
      return await returnDisplayFromDocumentForValue(modelDoc, '_display', modelDoc.toObject()._display, mongoose, logger)
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
    instanceMongoose = mongoose,
    logLevel = 'none',
    logger: customLogger
  } = options

  // Use custom logger if provided, otherwise create default logger
  const logger = customLogger ?? createDefaultLogger(logLevel)
  logger.info('Initializing mongoose-tracker plugin with options:', {
    name,
    fieldsToTrackCount: fieldsToTrack.length,
    fieldsNotToTrackCount: fieldsNotToTrack.length,
    limit,
    logLevel
  })

  fieldsToTrack.forEach((field) => {
    if (!isValidPattern(field)) {
      logger.error(`Invalid field pattern detected: ${field}`)
      throw new Error(`Invalid field pattern: ${field}`)
    }
  })

  schema.add({
    [name]: Array
  })

  const trackChanges = async (doc: any, path: string, value: any, history: History, displayField: string): Promise<void> => {
    logger.debug(`Tracking changes for path: ${path}, displayField: ${displayField}`)

    if (isObject(value) && !isArray(value) && !isDate(value) && !isUndefined(value) && !isNull(value)) {
      const isMongooseDoc = typeof (value as any).toObject === 'function' && (value.constructor?.name === 'model' || value instanceof mongoose.Document)
      const plainObject = isMongooseDoc ? (value as any)?.toObject() : value
      if ('_display' in plainObject) {
        const beforeDisplay = get(doc, `${path}._display`) ?? null
        const afterDisplay = plainObject._display ?? null
        const v1 = await returnDisplayFromDocumentForValue(doc, `${path}._display`, beforeDisplay, instanceMongoose, logger)
        const v2 = await returnDisplayFromDocumentForValue(doc, `${path}._display`, afterDisplay, instanceMongoose, logger)
        if (beforeDisplay !== afterDisplay) {
          logger.debug(`_display changed for ${displayField}: ${v1} => ${v2}`)
          history.changes.push({
            field: displayField,
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
        logger.debug(`Array elements removed from ${path}:`, removed.length)
        history.action = 'removed'
        await Promise.all(
          removed.map(async (element: any, index) => {
            if (isObject(element) && !isArray(element)) {
              const valueDisplay = await returnDisplayFromDocumentForValue(doc, `${path}.${index}._display`, (element as any)._display, instanceMongoose, logger)
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
        logger.debug(`Array elements added to ${path}:`, added.length)
        history.action = 'added'
        await Promise.all(
          added.map(async (element, index) => {
            if (isObject(element) && !isArray(element)) {
              const valueDisplay = await returnDisplayFromDocumentForValue(doc, `${path}.${index}._display`, (element as any)._display, instanceMongoose, logger)
              history.changes.push({
                field: displayField,
                before: null,
                after: valueDisplay
              })
            } else {
              history.changes.push({
                field: displayField,
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
        logger.debug(`Primitive value changed for ${displayField}: ${get(doc, path)} => ${value}`)
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
      logger.debug('Skipping tracking for new document')
      return
    }

    const changedBy = (this._changedBy as string) ?? null
    const changedFields = this.modifiedPaths()

    logger.info(`Pre-save hook triggered for document ${this.id}, changed fields:`, changedFields)
    const history: History = {
      action: 'updated',
      at: Date.now(),
      changedBy: changedBy,
      changes: []
    }
    const currentHistoryRecords = this.get(name) as History[]

    const docBeforeUpdate = await (this.constructor as any).findById(this.id)
    if (isNull(docBeforeUpdate)) {
      logger.warn(`Document not found before update: ${this.id}`)
      return
    }

    for (const fieldPath of changedFields) {
      if (!shouldTrackField(fieldPath)) {
        logger.debug(`Skipping non-tracked field: ${fieldPath}`)
        continue
      }
      const newValue = get(this, fieldPath)
      const displayField = await getDisplayName(this, fieldPath, instanceMongoose, logger)

      if (isObjectIdValid(newValue) || isObjectIdValid(get(docBeforeUpdate, fieldPath))) {
        const refModel = (this as any).schema.path(fieldPath)?.options?.ref
        if (!isNull(refModel)) {
          logger.debug(`Processing ObjectId reference for field: ${fieldPath}, model: ${refModel}`)
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
      logger.debug('No changes detected, skipping history update')
      return
    }

    // Enforce history limit in the pre-save hook
    const updatedHistoryRecords = takeRight([...currentHistoryRecords, history], limit)
    this.set(`${name}`, updatedHistoryRecords)

    logger.info(`History updated with ${history.changes.length} changes, action: ${history.action}`)

    next()
  })

  // Middleware hooks for query-based updates
  const hooks: MongooseQueryMiddleware[] = [
    'findOneAndUpdate',
    'updateOne',
    'updateMany'
  ]

  schema.pre(hooks, async function (next) {
    const updatedFields = this.getUpdate()
    const { changedBy, skipMiddleware } = this.getOptions() as { changedBy: string, skipMiddleware: boolean }
    const query = this.getQuery()

    logger.info(`Query middleware triggered for ${this.model.modelName}, query:`, query)

    if (skipMiddleware) {
      logger.debug('Skipping middleware due to skipMiddleware flag')
      return next()
    }

    if (isNull(updatedFields) || isEmpty(updatedFields)) {
      logger.debug('No fields to update, skipping')
      return next()
    }

    const originalDoc = await this.model.findOne(query)

    if (isNull(originalDoc)) {
      logger.warn('Original document not found for query:', query)
      return next()
    }

    logger.debug(`Found original document ${originalDoc._id}`)

    const history: History = {
      action: 'updated',
      at: Date.now(),
      changedBy: changedBy ?? '',
      changes: []
    }

    // Iterate over updated fields
    for (const [path, value] of Object.entries(updatedFields)) {
      if (shouldTrackField(path)) {
        logger.debug(`Processing tracked field: ${path}`)
        if (isObjectIdValid(value) || isObjectIdValid(get(originalDoc, path))) {
          const refModel = (this as any).schema.path(path)?.options?.ref
          if (!isNull(refModel)) {
            logger.debug(`Resolving ObjectId reference for field: ${path}, model: ${refModel}`)
            const modelDoc = await instanceMongoose.model(refModel).findById(value)
            const oldValue = await instanceMongoose.model(refModel).findById(get(originalDoc, path))

            const beforeDisplay = oldValue?._display ?? get(originalDoc, path)
            const afterDisplay = modelDoc?._display ?? value

            logger.debug(`Reference resolved - before: ${beforeDisplay}, after: ${afterDisplay}`)

            history.changes.push({
              field: path,
              before: beforeDisplay,
              after: afterDisplay
            })
            continue
          }
        } else {
          await trackChanges(originalDoc, path, value, history, path)
        }
      } else {
        logger.debug(`Skipping non-tracked field: ${path}`)
      }
    }

    if (isEmpty(history.changes)) {
      logger.debug('No changes detected in tracked fields')
      return next()
    }

    const docUpdated = await this.model.findOne(query)

    if (isNull(docUpdated)) {
      logger.error('Document not found after update for query:', query)
      return next()
    }

    const oldHistory = docUpdated.get(`${name}`)
    await this.model.updateOne(
      query,
      { [name]: takeRight([...oldHistory, history], limit) },
      { skipMiddleware: true } as any
    )

    logger.info(`History updated for document ${docUpdated._id} with ${history.changes.length} changes`)

    next()
  })
}

export default mongooseTracker
export type { Options, History, Change, Logger, LogLevel } from './interfaces'
