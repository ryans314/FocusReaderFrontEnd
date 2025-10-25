// Shared primitive types
export type ID = string

// Profile
export interface UserRef { id: ID }

// Library
export interface Document {
  _id: ID
  name: string
  epubContent: string
}

export interface Library {
  _id: ID
  user: ID
  documents: ID[]
}

// Annotation
export interface Annotation {
  _id: ID
  creator: ID
  document: ID
  color?: string
  content?: string
  location: string
  tags: ID[]
}

// Focus Stats
export interface FocusSession {
  _id: ID
  user: ID
  document: ID
  startTime: string
  endTime: string | null
}

export interface FocusStats {
  id: ID
  user: ID
  focusSessionIds: ID[]
}

// Text Settings
export interface TextSettings {
  _id: ID
  font: string
  fontSize: number
  lineHeight: number
}

// Generic response shapes from the spec (Action vs Query)
export interface ErrorResp { error: string }
