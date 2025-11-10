import { api } from './client'
import type { ID, Annotation, Library, Document, FocusSession, FocusStats, TextSettings } from './types'

// Helper to unwrap action responses of shape { key: ID }
type IdResp<K extends string> = Record<K, ID>
type Empty = Record<string, never>

// Profile
export async function createAccount(username: string, password: string) {
  const { data } = await api.post<IdResp<'user'> | { error: string }>(
    '/api/Profile/createAccount',
    { username, password }
  )
  return data
}

export async function deleteAccount(user: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    '/api/Profile/deleteAccount',
    { user }
  )
  return data
}

export async function changePassword(user: ID, oldPassword: string, newPassword: string) {
  const { data } = await api.post<IdResp<'user'> | { error: string }>(
    '/api/Profile/changePassword',
    { user, oldPassword, newPassword }
  )
  return data
}

export async function authenticate(username: string, password: string) {
  const { data } = await api.post<IdResp<'user'> | { error: string }>(
    '/api/Profile/authenticate',
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
  >('/api/auth/login', { username, password })
  return data
}

// POST /api/auth/logout
export async function authLogout(session: ID) {
  const { data } = await api.post<
    | { request: ID; message: string }
    | { request: ID; error: string }
  >('/api/auth/logout', { session })
  return data
}

export async function getUserDetails(user: ID) {
  const { data } = await api.post<Array<{ username: string }> | { error: string }>(
    '/api/Profile/_getUserDetails',
    { user }
  )
  return data
}

// Library
export async function createLibrary(user: ID) {
  const { data } = await api.post<IdResp<'library'> | { error: string }>(
    '/api/Library/createLibrary',
    { user }
  )
  return data
}

export async function removeDocument(library: ID, document: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    '/api/Library/removeDocument',
    { library, document }
  )
  return data
}

// Note: server-side contract now requires a session id and handles
// annotation registration and text-settings creation during document
// creation. The frontend should pass the current session here.
export async function createDocument(name: string, epubContent: string, library: ID, session: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    '/api/Library/createDocument',
    { name, epubContent, library, session }
  )
  return data
}

export async function renameDocument(user: ID, newName: string, document: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    '/api/Library/renameDocument',
    { user, newName, document }
  )
  return data
}

export async function openDocument(user: ID, document: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    '/api/Library/openDocument',
    { user, document }
  )
  return data
}

export async function closeDocument(user: ID, document: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    '/api/Library/closeDocument',
    { user, document }
  )
  return data
}

export async function getLibraryByUser(user: ID) {
  const { data } = await api.post<Array<{ library: Library }> | { error: string }>(
    '/api/Library/_getLibraryByUser',
    { user }
  )
  return data
}

export async function getDocumentsInLibrary(library: ID) {
  const { data } = await api.post<Array<{ document: Document }> | { error: string }>(
    '/api/Library/_getDocumentsInLibrary',
    { library }
  )
  return data
}

export async function getDocumentDetails(document: ID) {
  const { data } = await api.post<Array<{ document: Document }> | { error: string }>(
    '/api/Library/_getDocumentDetails',
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
    '/api/Annotation/createAnnotation',
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
    '/api/Annotation/deleteAnnotation',
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
    '/api/Annotation/updateAnnotation',
    payload
  )
  return data
}

export async function searchAnnotations(user: ID, document: ID, criteria: string) {
  const { data } = await api.post<Array<{ annotations: Annotation[] }> | { error: string }>(
    '/api/Annotation/search',
    { user, document, criteria }
  )
  return data
}

// Focus Stats


export async function startSession(user: ID, document: ID, library: ID) {
  const { data } = await api.post<IdResp<'focusSession'> | { error: string }>(
    '/api/FocusStats/startSession',
    { user, document, library }
  )
  return data
}

export async function endSession(focusSession: ID) {
  const { data } = await api.post<IdResp<'focusSession'> | { error: string }>(
    '/api/FocusStats/endSession',
    { focusSession }
  )
  return data
}

export async function removeSession(focusSession: ID) {
  const { data } = await api.post<Empty | { error: string }>(
    '/api/FocusStats/removeSession',
    { focusSession }
  )
  return data
}

export async function viewStats(user: ID) {
  const { data } = await api.post<Array<{ focusStats: FocusStats }> | { error: string }>(
    '/api/FocusStats/_viewStats',
    { user }
  )
  return data
}

export async function getSessions(user: ID) {
  const { data } = await api.post<Array<{ focusSession: FocusSession }> | { error: string }>(
    '/api/FocusStats/_getSessions',
    { user }
  )
  return data
}

// Text Settings

// NOTE: TextSettings for a newly-created document are now created by the
// server as part of document creation. Frontend callers should no longer
// call a separate createDocumentSettings endpoint.

export async function editSettings(textSettings: ID, font: string, fontSize: number, lineHeight: number) {
  const { data } = await api.post<Empty | { error: string }>(
    '/api/TextSettings/editSettings',
    { textSettings, font, fontSize, lineHeight }
  )
  return data
}

export async function getUserDefaultSettings(user: ID) {
  const { data } = await api.post<Array<{ settings: TextSettings }> | { error: string }>(
    '/api/TextSettings/_getUserDefaultSettings',
    { user }
  )
  return data
}

export async function getDocumentCurrentSettings(document: ID) {
  const { data } = await api.post<Array<{ settings: TextSettings }> | { error: string }>(
    '/api/TextSettings/_getDocumentCurrentSettings',
    { document }
  )
  return data
}
