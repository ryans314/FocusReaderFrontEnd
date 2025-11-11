# API Specification: Annotation Concept

**Purpose:** allow users to create annotations within documents and search amongst their annotations

---

## API Endpoints

**Description:** Creates a new tag with a given title for a specific user.

**Requirements:**
- A tag with the given user and title must not already exist.

**Effects:**
- Creates a tag with the provided title.
- Returns the ID of the newly created tag.

**Request Body:**

```json
{
  "creator": "ID",
  "title": "string"
}
```

**Success Response Body (Action):**

```json
{
  "tag": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

--- -->
### POST /api/Annotation/createAnnotation

**Description:** Creates a new annotation within a document for a user.

**Requirements:**
- The document must exist (in Annotation concept's view), and its creator must match the provided creator.
- The location must exist and be a well-defined CFI string (validation is assumed by external caller).
- The color (if provided) must be a valid HTML color.
- At least one of color or content must not be omitted.

**Effects:**
- Creates and adds a new annotation with the specified creator, document, color, content, location, and tags to the set of Annotations.
- Adds the new annotation's ID to the document's set of annotations (within the Annotation concept's view).
- Returns the ID of the newly created annotation.

**Request Body:**

```json
{
  "creator": "ID",
  "document": "ID",
  "color": "string",
  "content": "string",
  "location": "string",
  "tags": ["ID"]
}
```

**Success Response Body (Action):**

```json
{
  "annotation": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Annotation/deleteAnnotation

**Description:** Deletes an existing annotation.

**Requirements:**
- The annotation must exist.
- The user must be the creator of the annotation.

**Effects:**
- Removes the annotation from all sets of Annotations.
- Removes the annotation's ID from the associated document's set of annotations.

**Request Body:**

```json
{
  "user": "ID",
  "annotation": "ID"
}
```

**Success Response Body (Action):**

```json
{}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Annotation/updateAnnotation

**Description:** Modifies the properties of an existing annotation.

**Requirements:**
- The annotation must exist and its creator must match the provided user.
- The newColor (if provided) must be a valid HTML color.
- Any of newColor, newContent, newLocation, and newTags may be omitted for partial updates.

**Effects:**
- Modifies the specified annotation to have the provided newColor, newContent, newLocation, and newTags for each attribute that is not omitted.
- Returns the ID of the updated annotation.

**Request Body:**

```json
{
  "user": "ID",
  "annotation": "ID",
  "newColor": "string",
  "newContent": "string",
  "newLocation": "string",
  "newTags": ["ID"]
}
```

**Success Response Body (Action):**

```json
{
  "annotation": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Annotation/search

**Description:** Searches for annotations within a document that match specific criteria.

**Requirements:**
- The document must exist (in Annotation concept's view).

**Effects:**
- Returns a list of annotations created by the user within the specified document that have content or tags matching the criteria.

**Request Body:**

```json
{
  "user": "ID",
  "document": "ID",
  "criteria": "string"
}
```

**Success Response Body (Query):**

```json
[
  {
    "annotations": [
      {
        "_id": "ID",
        "creator": "ID",
        "document": "ID",
        "color": "string",
        "content": "string",
        "location": "string",
        "tags": ["ID"]
      }
    ]
  }
]
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Annotation/registerDocument

**Description:** Registers a document in the Annotation concept's view. This is a temporary, unsecured helper so front-end clients (or scripts) can make the Annotation concept aware of a document created elsewhere (for example, by the Library concept) until a backend sync is implemented.

**Requirements:**
- None (this helper does not perform authentication or additional validation beyond existence in the concept's collection).

**Effects:**
- Inserts a document view record for the provided document ID and creator ID. If the document is already registered, an error is returned by the current implementation.

**Request Body:**

```json
{
  "documentId": "ID",
  "creatorId": "ID"
}
```

**Success Response Body (Action):**

```json
{}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

# API Specification: FocusStats Concept

**Purpose:** track and aggregate users' reading statistics

---

## API Endpoints

### POST /api/FocusStats/removeSession

*   **Description:** Removes a specific focus/reading session record.
*   **Authorization:** Requires a valid `session` ID to authorize the request (the system does not currently verify that the session belongs to the user, only that the request is from a logged-in user).
*   **Request Body:**
    ```json
    {
      "session": "ID",
      "focusSession": "ID"
    }
    ```
*   **Success Response Body:**
    ```json
    {
      "success": true
    }
    ```
*   **Error Response Body:**
    ```json
    {
      "error": "Session with id [session_id] not found"
    }
    ```
    ```json
    {
      "error": "FocusSession [focus_session_id] not found."
    }
    ```

---

### POST /api/FocusStats/\_viewStats

*   **Description:** Retrieves the high-level reading statistics for the user associated with the provided session.
*   **Authorization:** Requires a valid `session` ID in the request body.
*   **Request Body:**
    ```json
    {
      "session": "ID"
    }
    ```
*   **Success Response Body:** A JSON object containing the stats data.
    ```json
    {
      "stats": {
        "id": "ID",
        "user": "ID",
        "focusSessionIds": ["ID", "ID", "..."]
      }
    }
    ```
*   **Error Response Body:** An object containing an error message.
    ```json
    {
      "error": "FocusStats not found for user [user_id]."
    }
    ```

### POST /api/FocusStats/\_getSessions

*   **Description:** Retrieves the detailed data for all reading sessions of the user associated with the provided session.
*   **Authorization:** Requires a valid `session` ID in the request body.
*   **Request Body:**
    ```json
    {
      "session": "ID"
    }
    ```
*   **Success Response Body:** A JSON object containing a flat array of all session objects.
    ```json
    {
      "sessions": [
        {
          "_id": "ID",
          "user": "ID",
          "document": "ID",
          "startTime": "Date",
          "endTime": "Date | null"
        },
        {
          "_id": "ID",
          "user": "ID",
          "document": "ID",
          "startTime": "Date",
          "endTime": "Date | null"
        }
      ]
    }
    ```
*   **Note:** If the user has no sessions, the response will be `{"sessions": []}`.

# API Specification: Library Concept

**Purpose:** allow users to add, remove, view, and access their uploaded documents

---

## API Endpoints

### POST /api/Library/removeDocument

*   **Description:** Removes a specified document from the library of the user associated with the provided session.
*   **Authorization:** Requires a valid `session` ID.
*   **Request Body:**
    ```json
    {
      "session": "ID",
      "document": "ID"
    }
    ```
*   **Success Response Body:**
    ```json
    {
      "success": true
    }
    ```
*   **Error Response Body:**
    ```json
    {
      "error": "Session with id [session_id] not found"
    }
    ```
    ```json
    {
      "error": "Document [document_id] is not in library [library_id]."
    }
    ```

---

### POST /api/Library/createDocument

**Description:** Creates a new document, registers it with dependent services (like Annotations and TextSettings), and adds it to a user's library. This is an authenticated endpoint that requires a valid user session.

**Requirements:**

*   The user must provide a valid `session` ID obtained from a successful login.
*   The provided `library` ID must exist and belong to the authenticated user.
*   A document with the given `name` must not already exist in the specified library.

**Effects:**

*   If successful:
    *   A new document record is created with the provided name and content.
    *   The new document's ID is added to the user's library.
    *   The document is registered with the Annotation concept, allowing annotations to be created.
    *   Default text settings are created and associated with the new document.
    *   The ID of the newly created document is returned.
*   If any step fails (e.g., invalid session, incorrect library ID, duplicate name), an error message is returned.

**Request Body:**

```json
{
  "name": "string",
  "epubContent": "string",
  "session": "ID",
  "library": "ID"
}
```

**Success Response Body (Action):**

```json
{
  "request": "ID",
  "document": "ID",
  "message": "string"
}
```

**Error Response Body:**

```json
{
  "request": "ID",
  "error": "string"
}
```### POST /api/Library/renameDocument

**Description:** Changes the name of an existing document within a user's library.

**Requirements:**
- The document must exist.
- The document must be associated with a library owned by the specified user.
- The newName must not be the name of an existing document within that user's library (excluding the document being renamed).

**Effects:**
- Changes the specified document's name to the newName.
- Returns the ID of the updated document.

**Request Body:**

```json
{
  "user": "ID",
  "newName": "string",
  "document": "ID"
}
```

**Success Response Body (Action):**

```json
{
  "document": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Library/openDocument

**Description:** Confirms a document is accessible to a user and begins tracking their reading time for that document.

**Requirements:**

* The user must be in a library that contains the specified document.

**Effects:**

* Confirms the document is accessible to the user (no state change explicitly tracked by this concept for "open" status).
* Returns the ID of the document.

**Side Effects (via Synchronization):**

* **Triggers `FocusStats.startSession`:** This action automatically starts a new focus session in the `FocusStats` concept, effectively starting a timer to track the user's reading time for this document.

**Request Body:**

```json
{
  "user": "ID",
  "document": "ID"
}
```

**Success Response Body (Action):**

```json
{
  "document": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

***

### POST /api/Library/closeDocument

**Description:** Confirms a document is no longer actively being accessed by a user and stops tracking their reading time.

**Requirements:**

* The user must be in a library that contains the specified document.

**Effects:**

* Confirms the document is no longer actively being accessed by the user (no state change explicitly tracked by this concept for "close" status).
* Returns the ID of the document.

**Side Effects (via Synchronization):**

* **Triggers `FocusStats.endSession`:** This action automatically finds the active focus session for the user and document and sets its end time, effectively stopping the reading timer and saving the session duration.

**Request Body:**

```json
{
  "user": "ID",
  "document": "ID"
}
```

**Success Response Body (Action):**

```json
{
  "document": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```


### POST /api/Library/_getLibraryByUser

**Description:** Retrieves the library document associated with a specific user.

**Requirements:**
- The user must exist and have a library.

**Effects:**
- Returns the full library document for the specified user.

**Request Body:**

```json
{
  "user": "ID"
}
```

**Success Response Body (Query):**

```json
[
  {
    "library": {
      "_id": "ID",
      "user": "ID",
      "documents": ["ID"]
    }
  }
]
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Library/_getDocumentsInLibrary

**Description:** Retrieves all documents (including their content) that are part of a given library.

**Requirements:**
- The library must exist.

**Effects:**
- Returns an array of document objects, each containing its ID, name, and epub content, for all documents in the specified library.

**Request Body:**

```json
{
  "library": "ID"
}
```

**Success Response Body (Query):**

```json
[
  {
    "document": {
      "_id": "ID",
      "name": "string",
      "epubContent": "string"
    }
  }
]
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Library/_getDocumentDetails

**Description:** Retrieves the full details (name, epubContent) of a specific document.

**Requirements:**
- The document must exist.

**Effects:**
- Returns the document object containing its ID, name, and epub content.

**Request Body:**

```json
{
  "document": "ID"
}
```

**Success Response Body (Query):**

```json
[
  {
    "document": {
      "_id": "ID",
      "name": "string",
      "epubContent": "string"
    }
  }
]
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

# API Specification: Profile Concept

**Purpose:** collect basic authentication and user info

---

## API Endpoints

### POST /api/Profile/deleteAccount

*   **Description:** Deletes the account associated with the provided session.
*   **Authorization:** Requires a valid `session` ID. The server uses this to identify which user account to delete.
*   **Request Body:**
    ```json
    {
      "session": "ID"
    }
    ```
*   **Success Response Body:**
    ```json
    {
      "success": true
    }
    ```
*   **Error Response Body:**
    ```json
    {
      "error": "Session with id [session_id] not found"
    }
    ```
    ```json
    {
      "error": "User '[user_id]' not found."
    }
    ```

---

### POST /api/Profile/changePassword

*   **Description:** Changes the password for the user associated with the provided session.
*   **Authorization:** Requires a valid `session` ID.
*   **Request Body:**
    ```json
    {
      "session": "ID",
      "oldPassword": "string",
      "newPassword": "string"
    }
    ```
*   **Success Response Body:**
    ```json
    {
      "user": "ID"
    }
    ```
*   **Error Response Body:**
    ```json
    {
      "error": "Session with id [session_id] not found"
    }
    ```
    ```json
    {
      "error": "Incorrect old password."
    }
    ```
---

### POST /api/Profile/authenticate

**Description:** Authenticates a user with their username and password.

**Requirements:**
- The provided username and password must both correspond to the same existing user (after password hashing verification).

**Effects:**
- Returns the ID of the user associated with the successfully authenticated username and password.

**Request Body:**

```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response Body (Action):**

```json
{
  "user": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/Profile/_getUserDetails

*   **Description:** Retrieves the username for the user associated with the provided session.
*   **Authorization:** Requires a valid `session` ID.
*   **Request Body:**
    ```json
    {
      "session": "ID"
    }
    ```
*   **Success Response Body (Query):**
    ```json
    {
        "username": "string"
    }
    ```
*   **Error Response Body:**
    ```json
    {
        "error": "User '[user_id]' not found."
    }
    ```

---

# API Specification: TextSettings Concept

**Purpose:** allow users to customize and set different text/display settings for each of their documents

---

## API Endpoints

### POST /api/TextSettings/createDocumentSettings

**Description:** Creates a new text display settings configuration and sets it as the current settings for a document.

**Requirements:**
- The document must exist (implicitly handled by external concept providing Document ID).
- There must not already be a current TextSettings for this document.
- The font must be a valid HTML font string.
- The fontSize must be a positive number.
- The lineHeight must be greater than or equal to the fontSize.

**Effects:**
- Creates a new TextSettings configuration with the given font, fontSize, and lineHeight.
- Associates this new configuration as the current settings for the specified document.
- Returns the ID of the created TextSettings configuration.

**Request Body:**

```json
{
  "font": "string",
  "fontSize": "number",
  "lineHeight": "number",
  "document": "ID"
}
```

**Success Response Body (Action):**

```json
{
  "settings": "ID"
}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/TextSettings/editSettings

**Description:** Modifies an existing text settings configuration.

**Requirements:**
- The textSettings (identified by its ID) must exist.
- The font must be a valid HTML font string.
- The fontSize must be a positive number.
- The lineHeight must be greater than or equal to the fontSize.

**Effects:**
- Modifies the TextSettings configuration identified by textSettingsId to have the new font, fontSize, and lineHeight.

**Request Body:**

```json
{
  "textSettings": "ID",
  "font": "string",
  "fontSize": "number",
  "lineHeight": "number"
}
```

**Success Response Body (Action):**

```json
{}
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/TextSettings/_getUserDefaultSettings

**Description:** Retrieves the default text settings configuration for a given user.

**Requirements:**
- The user must exist (implicitly handled).

**Effects:**
- Returns an array containing the default TextSettings configuration for the user, if one exists.
- Returns an empty array if no default settings are found for the user.

**Request Body:**

```json
{
  "user": "ID"
}
```

**Success Response Body (Query):**

```json
[
  {
    "settings": {
      "_id": "ID",
      "font": "string",
      "fontSize": "number",
      "lineHeight": "number"
    }
  }
]
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

### POST /api/TextSettings/_getDocumentCurrentSettings

**Description:** Retrieves the current text settings configuration for a given document.

**Requirements:**
- The document must exist (implicitly handled).

**Effects:**
- Returns an array containing the current TextSettings configuration for the document, if one exists.
- Returns an empty array if no current settings are found for the document.

**Request Body:**

```json
{
  "document": "ID"
}
```

**Success Response Body (Query):**

```json
[
  {
    "settings": {
      "_id": "ID",
      "font": "string",
      "fontSize": "number",
      "lineHeight": "number"
    }
  }
]
```

**Error Response Body:**

```json
{
  "error": "string"
}
```

---

# API Specification: Authentication & Sessioning Endpoints

**Purpose:** Manage user authentication and session states.

***

## API Endpoints

### POST /api/auth/login

**Description:** Authenticates a user with their username and password, and if successful, creates a new session for them.

**Requirements:**

* The provided `username` and `password` must correspond to an existing user account.

**Effects:**

* If authentication is successful:
    * A new session (`Session`) is created and associated with the authenticated `user`.
    * The ID of the authenticated user and the new session ID are returned.
* If authentication fails:
    * An error message detailing the reason for failure is returned.

**Request Body:**

```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response Body (Action):**

```json
{
  "request": "ID",
  "user": "ID",
  "session": "ID",
  "message": "string"
}
```

**Error Response Body:**

```json
{
  "request": "ID",
  "error": "string"
}
```

***

### POST /api/auth/logout

**Description:** Invalidates and deletes an active user session, effectively logging the user out.

**Requirements:**

* The provided `session` ID must correspond to an existing active session.

**Effects:**

* If the session exists:
    * The specified session is removed from the system.
    * A success message is returned.
* If the session does not exist:
    * An error message indicating the session was not found is returned.

**Request Body:**

```json
{
  "session": "ID"
}
```

**Success Response Body (Action):**

```json
{
  "request": "ID",
  "message": "string"
}
```

**Error Response Body:**

```json
{
  "request": "ID",
  "error": "string"
}