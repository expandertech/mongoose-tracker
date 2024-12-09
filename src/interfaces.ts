import mongoose from 'mongoose'

export interface Options {
  name?: string
  limit?: number
  fieldsToTrack?: string[]
  fieldsNotToTrack?: string[]
  instnaceMongoose?: typeof mongoose
}

export interface Change {
  field: string
  before: string
  after: string
}

type Action = 'updated' | 'created' | 'deleted' | 'removed' | 'added'

export interface History {
  changes: Change[]
  at: number
  changedBy: string | null
  action: Action
}
