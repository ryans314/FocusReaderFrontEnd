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

export async function getUserDetails(user: ID) {
  const { data } = await api.post<Array<{ username: string }> | { error: string }>(
    '/api/Profile/_getUserDetails',
    { user }
  )
  return data
}

export async function getAllUsers() {
  const { data } = await api.post<Array<{ id: ID; username: string }> | { error: string }>(
    '/api/Profile/_getAllUsers',
    {}
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

export async function createDocument(name: string, epubContent: string, library: ID) {
  const { data } = await api.post<IdResp<'document'> | { error: string }>(
    '/api/Library/createDocument',
    { name, epubContent, library }
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
export async function createTag(creator: ID, title: string) {
  const { data } = await api.post<IdResp<'tag'> | { error: string }>(
    '/api/Annotation/createTag',
    { creator, title }
  )
  return data
}

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
export async function registerDocumentWithAnnotationConcept(creatorId: ID, documentId: ID) {
  // Matches API spec: POST /api/Annotation/registerDocument with { documentId, creatorId }
  const { data } = await api.post<Record<string, never> | { error: string }>(
    '/api/Annotation/registerDocument',
    { documentId, creatorId }
  )
  return data
}

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
export async function initUserFocusStats(user: ID) {
  const { data } = await api.post<IdResp<'focusStats'> | { error: string }>(
    '/api/FocusStats/initUser',
    { user }
  )
  return data
}

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
export async function createUserSettings(font: string, fontSize: number, lineHeight: number, user: ID) {
  const { data } = await api.post<IdResp<'settings'> | { error: string }>(
    '/api/TextSettings/createUserSettings',
    { font, fontSize, lineHeight, user }
  )
  return data
}

export async function createDocumentSettings(font: string, fontSize: number, lineHeight: number, document: ID) {
  const { data } = await api.post<IdResp<'settings'> | { error: string }>(
    '/api/TextSettings/createDocumentSettings',
    { font, fontSize, lineHeight, document }
  )
  return data
}

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

export async function getTextSettings(textSettingsId: ID) {
  const { data } = await api.post<Array<{ settings: TextSettings }> | { error: string }>(
    '/api/TextSettings/_getTextSettings',
    { textSettingsId }
  )
  return data
}
