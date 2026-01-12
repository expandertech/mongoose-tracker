import mongoose from 'mongoose'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none'

export interface Logger {
  debug: (message: string, ...args: any[]) => void
  info: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
}

export interface Options {
  name?: string
  limit?: number
  fieldsToTrack?: string[]
  fieldsNotToTrack?: string[]
  instanceMongoose?: typeof mongoose
  logLevel?: LogLevel
  logger?: Logger
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
