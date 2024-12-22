import mongoose from 'mongoose'

export interface Options {
  name?: string
  limit?: number
  fieldsToTrack?: string[]
  fieldsNotToTrack?: string[]
  instanceMongoose?: typeof mongoose
}

export interface Change {
  field: string
  before: string | null
  after: string | null
}

type Action = 'updated' | 'created' | 'deleted' | 'removed' | 'added'

export interface History {
  changes: Change[]
  at: number
  changedBy: string | null
  action: Action
}
