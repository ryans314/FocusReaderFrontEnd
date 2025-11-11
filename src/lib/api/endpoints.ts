import { api } from './client'
import type { ID, Annotation, Library, Document, FocusSession, FocusStats, TextSettings } from './types'

// Helper to unwrap action responses of shape { key: ID }
type IdResp<K extends string> = Record<K, ID>
type Empty = Record<string, never>

// Profile
export async function createAccount(username: string, password: string) {
  const { data } = await api.post<IdResp<'user'> | { error: string }>(
    'Profile/createAccount',
    { username, password }
  )
  return data
}

export async function deleteAccount(session: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    'Profile/deleteAccount',
    { session }
  )
  return data
}

export async function changePassword(session: ID, oldPassword: string, newPassword: string) {
  const { data } = await api.post<IdResp<'user'> | { error: string }>(
    'Profile/changePassword',
    { session, oldPassword, newPassword }
  )
  return data
}

export async function authenticate(username: string, password: string) {
  const { data } = await api.post<IdResp<'user'> | { error: string }>(
    'Profile/authenticate',
    { username, password }
  )
  return data
}

// New authentication/session endpoints
// POST /api/auth/login
export async function authLogin(username: string, password: string) {
  const { data } = await api.post<
    | { request: ID; user: ID; session: ID; message: string }
    | { request: ID; error: string }
  >('auth/login', { username, password })
  return data
}

// POST /api/auth/logout
export async function authLogout(session: ID) {
  const { data } = await api.post<
    | { request: ID; message: string }
    | { request: ID; error: string }
  >('auth/logout', { session })
  return data
}

export async function getUserDetails(session: ID) {
  const { data } = await api.post<Array<{ username: string }> | { error: string }>(
    'Profile/_getUserDetails',
    { session }
  )
  return data
}

// Library
export async function createLibrary(user: ID) {
  const { data } = await api.post<IdResp<'library'> | { error: string }>(
    'Library/createLibrary',
    { user }
  )
  return data
}

export async function removeDocument(session: ID, document: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    'Library/removeDocument',
    { session, document }
  )
  return data
}

// Note: server-side contract now requires a session id and handles
// annotation registration and text-settings creation during document
// creation. The frontend should pass the current session here.
export async function createDocument(name: string, epubContent: string, library: ID, session: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    'Library/createDocument',
    { name, epubContent, library, session }
  )
  return data
}

export async function renameDocument(user: ID, newName: string, document: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    'Library/renameDocument',
    { user, newName, document }
  )
  return data
}

export async function openDocument(user: ID, document: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    'Library/openDocument',
    { user, document }
  )
  return data
}

export async function closeDocument(user: ID, document: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    'Library/closeDocument',
    { user, document }
  )
  return data
}

export async function getLibraryByUser(user: ID) {
  const { data } = await api.post<Array<{ library: Library }> | { error: string }>(
    'Library/_getLibraryByUser',
    { user }
  )
  return data
}

export async function getDocumentsInLibrary(library: ID) {
  const { data } = await api.post<Array<{ document: Document }> | { error: string }>(
    'Library/_getDocumentsInLibrary',
    { library }
  )
  return data
}

export async function getDocumentDetails(document: ID) {
  const { data } = await api.post<Array<{ document: Document }> | { error: string }>(
    'Library/_getDocumentDetails',
    { document }
  )
  return data
}

// Annotation
export async function createAnnotation(payload: {
  creator: ID
  document: ID
  color?: string
  content?: string
  location: string
  tags: ID[]
}) {
  const { data } = await api.post<IdResp<'annotation'> | { error: string }>(
    'Annotation/createAnnotation',
    payload
  )
  return data
}

// Front-end convenience: register a document with the Annotation concept so
// the backend will accept subsequent annotation creates. This is a temporary
// "front-end sync" until the backend performs this automatically.
// NOTE: Registration of documents with the Annotation concept is now
// performed server-side during createDocument. The front-end no longer
// needs to call a separate register endpoint.

export async function deleteAnnotation(user: ID, annotation: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    'Annotation/deleteAnnotation',
    { user, annotation }
  )
  return data
}

export async function updateAnnotation(payload: {
  user: ID
  annotation: ID
  newColor?: string
  newContent?: string
  newLocation?: string
  newTags?: ID[]
}) {
  const { data } = await api.post<IdResp<'annotation'> | { error: string }>(
    'Annotation/updateAnnotation',
    payload
  )
  return data
}

export async function searchAnnotations(user: ID, document: ID, criteria: string) {
  const { data } = await api.post<Array<{ annotations: Annotation[] }> | { error: string }>(
    'Annotation/search',
    { user, document, criteria }
  )
  return data
}

// Focus Stats


// NOTE: Starting and ending focus sessions is now performed implicitly by
// the Library concept's openDocument/closeDocument actions on the server.
// The frontend should call openDocument/closeDocument; the server will
// create and finalize FocusStats sessions. Explicit startSession/endSession
// endpoints are no longer required by the client and have been removed.

export async function removeSession(session: ID, focusSession: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    'FocusStats/removeSession',
    { session, focusSession }
  )
  return data
}

export async function viewStats(session: ID) {
  const { data } = await api.post<any | { error: string }>(
    'FocusStats/_viewStats',
    { session }
  )
  // Normalize possible server shapes to Array<{ focusStats: FocusStats }>
  try {
    if (!data) return data
    // If server returns { stats: { ... } } => wrap
    if (data.stats && !Array.isArray(data.stats)) {
      return [{ focusStats: data.stats }]
    }
    // If server returns { stats: [ ... ] }
    if (data.stats && Array.isArray(data.stats)) {
      return data.stats.map((s: any) => ({ focusStats: s }))
    }
    // If server already returns Array<{ focusStats }>
    if (Array.isArray(data)) return data
    // Fallback: return as-is
    return data
  } catch {
    return data
  }
}

export async function getSessions(session: ID) {
  const { data } = await api.post<any | { error: string }>(
    'FocusStats/_getSessions',
    { session }
  )
  // Normalize to Array<{ focusSession: FocusSession }>
  try {
    if (!data) return data
    if (data.sessions && !Array.isArray(data.sessions)) {
      return [{ focusSession: data.sessions }]
    }
    if (data.sessions && Array.isArray(data.sessions)) {
      return data.sessions.map((s: any) => ({ focusSession: s }))
    }
    if (Array.isArray(data)) return data
    return data
  } catch {
    return data
  }
}

// Text Settings

// NOTE: TextSettings for a newly-created document are now created by the
// server as part of document creation. Frontend callers should no longer
// call a separate createDocumentSettings endpoint.

export async function editSettings(textSettings: ID, font: string, fontSize: number, lineHeight: number) {
  const { data } = await api.post<Empty | { error: string }>(
    'TextSettings/editSettings',
    { textSettings, font, fontSize, lineHeight }
  )
  return data
}

export async function getUserDefaultSettings(user: ID) {
  const { data } = await api.post<Array<{ settings: TextSettings }> | { error: string }>(
    'TextSettings/_getUserDefaultSettings',
    { user }
  )
  return data
}

export async function getDocumentCurrentSettings(document: ID) {
  const { data } = await api.post<Array<{ settings: TextSettings }> | { error: string }>(
    'TextSettings/_getDocumentCurrentSettings',
    { document }
  )
  return data
}
