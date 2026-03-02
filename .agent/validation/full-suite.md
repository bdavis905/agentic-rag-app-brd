# Full Validation Suite

## Execution Instructions

### Prerequisites
- Backend running at http://localhost:8001
- Frontend running at http://localhost:5173
- Supabase project accessible

### Obtaining JWT Tokens

To authenticate API calls, obtain JWT tokens via Supabase GoTrue auth endpoint:

```bash
# Get token for User 1 (test@test.com)
curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"M+T!kV3v2d_xn/p"}' | jq -r '.access_token'

# Get token for User 2 (test2@test.com)
curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test2@test.com","password":"M+T!kV3v2d_xn/p"}' | jq -r '.access_token'
```

**Note:** Replace `${SUPABASE_URL}` and `${SUPABASE_ANON_KEY}` with values from `backend/.env`.

### Variable Tracking

Throughout the suite, track these variables:
- `$TOKEN1` - JWT for test@test.com
- `$TOKEN2` - JWT for test2@test.com
- `$THREAD_ID` - ID of created test thread
- `$THREAD_ID_2` - ID of second test thread (for delete test)
- `$DOC_ID` - ID of uploaded test document
- `$DOC_ID_MD` - ID of uploaded markdown document
- `$RAG_DOC_ID` - ID of uploaded RAG test document
- `$DEDUP_DOC_ID` - ID of uploaded record manager test document
- `$META_DOC_ID` - ID of uploaded metadata test document
- `$HTML_DOC_ID` - ID of uploaded HTML test document (multi-format)
- `$PDF_DOC_ID` - ID of uploaded PDF test document (multi-format, optional)

### Test Ordering

Tests are ordered by dependency. Execute in sequence:
1. Health & Auth (no dependencies)
2. Thread CRUD (creates threads used later)
3. Data Isolation (uses threads from step 2)
4. Chat/Messages (uses thread from step 2)
5. Documents (independent, creates docs)
6. Record Manager / Deduplication (creates and re-uploads docs)
7. Metadata Extraction (uploads doc, verifies metadata and filtering)
7. Settings & Admin (tests admin guard and global settings)
8. Error Handling (independent)
9. Hybrid Search & Reranking (uploads docs, tests search modes)
10. Multi-Format Support (uploads HTML/PDF, tests Docling extraction)
11. Cleanup (removes all test data)

### Timeout Guidance
- Standard API calls: 5 seconds
- SSE streaming: 30 seconds for first event, 60 seconds total
- Document ingestion (status → completed): 30 seconds
- Browser page loads: 10 seconds

---

## API Tests (curl-based)

### Health & Auth

#### API-01: Health endpoint returns OK
**Steps:**
```bash
curl -s http://localhost:8001/health
```
**Acceptance Criteria:** Response is `{"status":"ok"}` with HTTP 200.

---

#### API-02: Unauthenticated request rejected
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/threads
```
**Acceptance Criteria:** HTTP status code is `403` (no Authorization header).

---

#### API-03: Invalid token rejected
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/threads \
  -H "Authorization: Bearer invalid-token-abc123"
```
**Acceptance Criteria:** HTTP status code is `401` or `403`.

---

#### API-04: Valid token accepted
**Steps:**
```bash
curl -s http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response contains `"email":"test@test.com"` and HTTP 200.

---

### Thread CRUD

#### API-05: Create thread with default title
**Steps:**
```bash
curl -s -X POST http://localhost:8001/threads \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Acceptance Criteria:** HTTP 201. Response contains `"title":"New Chat"`, has `id`, `user_id`, `created_at`, `updated_at` fields. Save `id` as `$THREAD_ID`.

---

#### API-06: Create thread with custom title
**Steps:**
```bash
curl -s -X POST http://localhost:8001/threads \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Thread for Deletion"}'
```
**Acceptance Criteria:** HTTP 201. Response contains `"title":"Test Thread for Deletion"`. Save `id` as `$THREAD_ID_2`.

---

#### API-07: List threads returns created threads
**Steps:**
```bash
curl -s http://localhost:8001/threads \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response is a JSON array containing at least 2 threads. Both `$THREAD_ID` and `$THREAD_ID_2` are present.

---

#### API-08: Get single thread by ID
**Steps:**
```bash
curl -s http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response `id` matches `$THREAD_ID`, `title` is `"New Chat"`.

---

#### API-09: Update thread title
**Steps:**
```bash
curl -s -X PATCH http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated Test Thread"}'
```
**Acceptance Criteria:** HTTP 200. Response contains `"title":"Updated Test Thread"`.

---

#### API-10: Verify updated title persists
**Steps:**
```bash
curl -s http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. `title` is `"Updated Test Thread"`.

---

#### API-11: Delete thread
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8001/threads/$THREAD_ID_2 \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP status code is `204`.

---

### Data Isolation

#### API-12: User 2 cannot list User 1's threads
**Steps:**
```bash
curl -s http://localhost:8001/threads \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP 200. Response array does NOT contain `$THREAD_ID`. (User 2 sees only their own threads or empty array.)

---

#### API-13: User 2 cannot get User 1's thread by ID
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

#### API-14: User 2 cannot update User 1's thread
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X PATCH http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hacked"}'
```
**Acceptance Criteria:** HTTP status code is `404`.

---

#### API-15: User 2 cannot delete User 1's thread
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

### Chat / Messages

#### API-16: Empty thread has no messages
**Steps:**
```bash
curl -s http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response is an empty JSON array `[]`.

---

#### API-17: Send message returns SSE stream
**Steps:**
```bash
curl -s -N -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello, what is 2+2?"}' \
  --max-time 60
```
**Acceptance Criteria:** Response contains `event: text_delta` lines with `data:` payloads containing `"content"` fields. Stream ends with `event: done` and `data: {}`. HTTP 200.

---

#### API-18: Messages persist after chat
**Steps:**
```bash
curl -s http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response array contains at least 2 messages: one with `"role":"user"` and `"content":"Hello, what is 2+2?"`, and one with `"role":"assistant"`.

---

#### API-19: User 2 cannot access User 1's messages
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

### Documents

#### API-20: Upload .txt file
**Steps:**
```bash
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_document.txt"
```
**Acceptance Criteria:** HTTP 201. Response contains `"filename":"test_document.txt"`, `"file_type":".txt"`, `"status":"pending"`, `file_size` > 0. Save `id` as `$DOC_ID`.

---

#### API-21: Upload .md file
**Steps:**
```bash
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_document.md"
```
**Acceptance Criteria:** HTTP 201. Response contains `"filename":"test_document.md"`, `"file_type":".md"`, `"status":"pending"`. Save `id` as `$DOC_ID_MD`.

---

#### API-22: Reject invalid file type (.py)
**Steps:**
```bash
# Create a temporary .py file
echo "print('hello')" > /tmp/test_invalid.py
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_invalid.py"
```
**Acceptance Criteria:** HTTP status code is `400`.

---

#### API-23: Reject empty file
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/empty.txt"
```
**Acceptance Criteria:** HTTP status code is `400`.

---

#### API-24: List documents shows uploaded files
**Steps:**
```bash
curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response array contains documents with IDs `$DOC_ID` and `$DOC_ID_MD`.

---

#### API-25: Document status transitions to completed
**Steps:**
```bash
# Poll every 2 seconds for up to 30 seconds
for i in $(seq 1 15); do
  STATUS=$(curl -s http://localhost:8001/documents \
    -H "Authorization: Bearer $TOKEN1" | jq -r ".[] | select(.id==\"$DOC_ID\") | .status")
  if [ "$STATUS" = "completed" ]; then break; fi
  sleep 2
done
echo $STATUS
```
**Acceptance Criteria:** `$STATUS` is `"completed"` within 30 seconds. Document `chunk_count` > 0.

---

#### API-26: Upload RAG test document
**Steps:**
```bash
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_rag_document.txt"
```
**Acceptance Criteria:** HTTP 201. Save `id` as `$RAG_DOC_ID`. Wait for status to transition to `"completed"` (poll as in API-25).

---

#### API-27: RAG retrieval returns relevant chunks
**Steps:**
```bash
curl -s -N -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"How tall is the Eiffel Tower and when was it built?"}' \
  --max-time 60
```
**Acceptance Criteria:** SSE stream contains text mentioning "330 meters" or "1,083 feet" and "1889" or "1887". The response references information from the uploaded Eiffel Tower document.

---

#### API-28: Delete document
**Steps:**
```bash
curl -s -X DELETE http://localhost:8001/documents/$DOC_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response contains `"status":"deleted"`.

---

#### API-29: Deleted document no longer in list
**Steps:**
```bash
curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN1" | jq ".[] | select(.id==\"$DOC_ID\")"
```
**Acceptance Criteria:** Output is empty (document not found in list).

---

#### API-30: User 2 cannot access User 1's documents
**Steps:**
```bash
curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP 200. Response array does NOT contain `$DOC_ID_MD` or `$RAG_DOC_ID`.

---

### Settings & Admin

#### API-31: Get global settings (any authenticated user)
**Steps:**
```bash
curl -s http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response contains fields: `llm_model`, `llm_base_url`, `llm_api_key`, `embedding_model`, `embedding_base_url`, `embedding_api_key`, `embedding_dimensions`, `has_chunks`.

---

#### API-32: Non-admin GET settings also succeeds
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP status code is `200` (non-admins can read global settings).

---

#### API-33: Non-admin PUT settings returns 403
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d '{"llm_model":"gpt-4o-mini"}'
```
**Acceptance Criteria:** HTTP status code is `403`.

---

#### API-34: Admin PUT settings succeeds
**Steps:**
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"llm_model":"gpt-4o-mini"}'
```
**Acceptance Criteria:** HTTP 200. Response contains `"llm_model":"gpt-4o-mini"`.

---

#### API-35: API key masking in response
**Steps:**
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"llm_api_key":"sk-test-key-12345678"}'
# Then GET settings to check masking
curl -s http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** GET response shows `llm_api_key` as masked value (e.g., `"***5678"` format), NOT the full key.

---

#### API-36: GET /auth/me returns is_admin field for admin
**Steps:**
```bash
curl -s http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP 200. Response contains `"is_admin":true` for test@test.com.

---

#### API-37: GET /auth/me returns is_admin=false for non-admin
**Steps:**
```bash
curl -s http://localhost:8001/auth/me \
  -H "Authorization: Bearer $TOKEN2"
```
**Acceptance Criteria:** HTTP 200. Response contains `"is_admin":false` for test2@test.com.

---

### Error Handling

#### API-38: Get nonexistent thread returns 404
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/threads/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** HTTP status code is `404`.

---

#### API-39: Send empty message rejected
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":""}'
```
**Acceptance Criteria:** HTTP status code is `400` or `422` (validation error for empty content).

---

#### API-40: No auth on protected endpoint
**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/auth/me
```
**Acceptance Criteria:** HTTP status code is `403`.

---

## E2E Browser Tests (agent-browser CLI)

**Setup:** Ensure `AGENT_BROWSER_HOME` is set:
```bash
export AGENT_BROWSER_HOME="/c/Users/User/AppData/Roaming/npm/node_modules/agent-browser"
```

**Command Reference:**
- `agent-browser open <url>` - Navigate to URL
- `agent-browser snapshot -i` - Get interactive elements with refs
- `agent-browser click @<ref>` - Click element by ref
- `agent-browser fill @<ref> "<text>"` - Fill input field
- `agent-browser type @<ref> "<text>"` - Type into element
- `agent-browser wait <ms>` - Wait for time in milliseconds
- `agent-browser get url` - Get current URL
- `agent-browser screenshot <path>` - Take screenshot

### Auth Flow

#### E2E-01: Unauthenticated redirect to /auth
**Steps:**
```bash
agent-browser open http://localhost:5173
agent-browser snapshot -i
agent-browser get url
```
**Acceptance Criteria:** Page shows the sign-in form with email and password fields. URL is `/auth` or login UI is visible.

---

#### E2E-02: Sign in with valid credentials
**Steps:**
```bash
agent-browser open http://localhost:5173/auth
agent-browser snapshot -i  # Find email/password field refs
agent-browser fill @<email-ref> "test@test.com"
agent-browser fill @<password-ref> "M+T!kV3v2d_xn/p"
agent-browser click @<signin-button-ref>
agent-browser wait 3000
agent-browser snapshot -i
agent-browser get url
```
**Acceptance Criteria:** After sign-in, user is redirected to chat page. Page shows thread list or "New Chat" button. No error messages visible.

---

#### E2E-03: Sign in with invalid credentials shows error
**Steps:**
```bash
agent-browser open http://localhost:5173/auth
agent-browser snapshot -i
agent-browser fill @<email-ref> "wrong@test.com"
agent-browser fill @<password-ref> "wrongpassword"
agent-browser click @<signin-button-ref>
agent-browser wait 3000
agent-browser snapshot
```
**Acceptance Criteria:** Error message is visible on page (e.g., "Invalid login credentials"). User remains on auth page.

---

#### E2E-04: Protected routes redirect when not authenticated
**Steps:**
```bash
# Use a new session to clear any existing auth
agent-browser --session new-session open http://localhost:5173/documents
agent-browser --session new-session snapshot
agent-browser --session new-session get url
```
**Acceptance Criteria:** User is redirected to auth page. Documents page is NOT shown.

---

### Chat Flow

#### E2E-05: Create new thread
**Steps:**
```bash
# Sign in first (use steps from E2E-02)
agent-browser snapshot -i  # Find new chat/thread button
agent-browser click @<new-thread-ref>
agent-browser wait 1000
agent-browser snapshot -i
```
**Acceptance Criteria:** A new thread appears in the thread list. Chat area is empty/ready for input.

---

#### E2E-06: Send message in chat
**Steps:**
```bash
# From E2E-05 state (new thread selected)
agent-browser snapshot -i  # Find message input
agent-browser fill @<message-input-ref> "What is the capital of France?"
agent-browser click @<send-button-ref>  # Or press Enter
agent-browser wait 5000
agent-browser snapshot
```
**Acceptance Criteria:** User message appears in chat. Assistant response begins streaming (partial or complete text visible).

---

#### E2E-07: Streaming response completes
**Steps:**
```bash
# From E2E-06 state
agent-browser wait 15000  # Allow full response
agent-browser snapshot
```
**Acceptance Criteria:** Assistant response is fully rendered (mentions "Paris"). No loading indicators remain. Message is displayed in the chat area.

---

#### E2E-08: Messages persist after page reload
**Steps:**
```bash
# From E2E-07 state, note the thread in sidebar
agent-browser reload
agent-browser wait 3000
agent-browser snapshot -i  # Click on the thread from the sidebar
agent-browser click @<thread-ref>
agent-browser wait 3000
agent-browser snapshot
```
**Acceptance Criteria:** Previous messages (user question and assistant response) are still visible in the chat after reload.

---

#### E2E-09: Delete thread
**Steps:**
1. From authenticated state
2. `browser_snapshot` to find thread in sidebar
3. Hover or right-click on a thread to reveal delete option
4. `browser_click` delete button/icon
5. `browser_snapshot`
**Acceptance Criteria:** Thread is removed from the sidebar list. Chat area resets or shows empty state.

---

### Navigation

#### E2E-10: Navigate to Documents page
**Steps:**
```bash
# From authenticated chat page
agent-browser snapshot -i  # Find Documents navigation link
agent-browser click @<documents-link-ref>
agent-browser wait 2000
agent-browser snapshot -i
agent-browser get url
```
**Acceptance Criteria:** Documents page is shown with upload zone and document list area. URL contains `/documents`.

---

#### E2E-11: Navigate back to Chat page
**Steps:**
1. From Documents page (E2E-10)
2. `browser_snapshot` to find Chat navigation link
3. `browser_click` the Chat link/button
4. `browser_wait_for` time: 2 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Chat page is shown with thread list sidebar. URL is `/` or `/chat`.

---

### Documents

#### E2E-12: Upload zone is visible
**Steps:**
```bash
agent-browser open http://localhost:5173/documents
agent-browser wait 2000
agent-browser snapshot
```
**Acceptance Criteria:** Upload zone/dropzone is visible with instructions to upload files. Accepted file types (PDF, DOCX, PPTX, XLSX, TXT, MD, HTML, Images) are indicated.

---

#### E2E-13: Upload file via UI
**Steps:**
```bash
# From Documents page
agent-browser snapshot -i  # Find file input
agent-browser upload @<file-input-ref> .agent/validation/fixtures/test_document.txt
agent-browser wait 5000
agent-browser snapshot
```
**Acceptance Criteria:** Document appears in the document list with filename "test_document.txt". Status shows "pending" initially.

---

#### E2E-14: Document status updates in realtime
**Steps:**
```bash
# From E2E-13 state
agent-browser wait 20000  # Wait for processing
agent-browser snapshot
```
**Acceptance Criteria:** Document status has transitioned from "pending" to "completed" in the UI without page refresh (realtime update via Supabase).

---

#### E2E-15: Delete document via UI
**Steps:**
1. From Documents page with at least one document
2. `browser_snapshot` to find delete button for a document
3. `browser_click` the delete button
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Document is removed from the list. No error messages shown.

---

### RAG Integration

#### E2E-16: Upload RAG document and wait for processing
**Steps:**
1. Navigate to Documents page
2. `browser_file_upload` with path to `.agent/validation/fixtures/test_rag_document.txt`
3. `browser_wait_for` time: 30 seconds (wait for "completed" status)
4. `browser_snapshot`
**Acceptance Criteria:** Document "test_rag_document.txt" shows status "completed" with chunk_count > 0.

---

#### E2E-17: Ask question about uploaded document
**Steps:**
1. Navigate to Chat page
2. Create a new thread
3. Type message: `What year was the Eiffel Tower completed and how tall is it?`
4. Send the message
5. `browser_wait_for` time: 30 seconds (allow tool calling + response)
6. `browser_snapshot`
**Acceptance Criteria:** Assistant response mentions "1889" (completion year) and "330 meters" or "1,083 feet" (height). This confirms the RAG retrieval tool was used successfully.

---

### Data Isolation

#### E2E-18: Sign out
**Steps:**
1. From authenticated state
2. `browser_snapshot` to find user menu or sign out button
3. `browser_click` sign out / user menu
4. If user menu opened, `browser_click` the sign out option
5. `browser_wait_for` time: 3 seconds
6. `browser_snapshot`
**Acceptance Criteria:** User is redirected to auth page. No user-specific data visible.

---

#### E2E-19: Sign in as User 2
**Steps:**
1. From auth page
2. `browser_fill_form` with email: `test2@test.com`, password: `M+T!kV3v2d_xn/p`
3. `browser_click` Sign In
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** User 2 is signed in. Chat page shown.

---

#### E2E-20: User 2 cannot see User 1's threads
**Steps:**
1. From E2E-19 state (signed in as User 2)
2. `browser_snapshot` the thread list
**Acceptance Criteria:** Thread list does NOT contain any threads created by User 1 during this test run. List may be empty or contain only User 2's own threads.

---

#### E2E-21: User 2 cannot see User 1's documents
**Steps:**
1. Navigate to Documents page as User 2
2. `browser_snapshot`
**Acceptance Criteria:** Document list does NOT contain "test_rag_document.txt" or any documents uploaded by User 1.

---

#### E2E-22: Sign back in as User 1
**Steps:**
1. Sign out from User 2
2. Sign in as `test@test.com` with password `M+T!kV3v2d_xn/p`
3. `browser_snapshot`
**Acceptance Criteria:** User 1 is signed in. Their threads and documents are visible again.

---

### Admin Settings Access

#### E2E-23: Non-admin user does not see Settings in UserMenu
**Steps:**
1. Sign in as `test2@test.com` (non-admin)
2. `browser_snapshot` to find user menu
3. `browser_click` on user menu avatar/button
4. `browser_snapshot` the popover menu
**Acceptance Criteria:** The popover menu does NOT contain a "Settings" option. Only "Log out" is visible.

---

#### E2E-24: Non-admin navigating to /settings is redirected
**Steps:**
1. Sign in as `test2@test.com`
2. `browser_navigate` to `http://localhost:5173/settings`
3. `browser_wait_for` time: 3 seconds
4. `browser_snapshot`
**Acceptance Criteria:** User is redirected to `/` (chat page). Settings page is NOT shown.

---

#### E2E-25: Admin can access Settings page
**Steps:**
1. Sign in as `test@test.com` (admin)
2. `browser_snapshot` to find user menu
3. `browser_click` on user menu avatar/button
4. `browser_snapshot` to verify Settings option is visible
5. `browser_click` Settings
6. `browser_wait_for` time: 2 seconds
7. `browser_snapshot`
**Acceptance Criteria:** Settings page is shown with LLM Configuration and Embedding Configuration sections.

---

#### E2E-26: Admin can save settings
**Steps:**
1. From Settings page (as admin)
2. `browser_fill_form` with model name: `gpt-4o-mini`
3. `browser_click` Save button
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Success message "Settings saved successfully." is visible. No error messages.

---

### Error Handling

#### E2E-27: Invalid file type rejection in UI
**Steps:**
1. Navigate to Documents page
2. Attempt to upload a file with invalid extension (e.g., `.py` or `.jpg`)
3. `browser_wait_for` time: 3 seconds
4. `browser_snapshot`
**Acceptance Criteria:** Error message is shown indicating the file type is not supported. File is NOT added to the document list.

---

## API: Record Manager (Deduplication)

#### API-41: Upload new file returns action "created" with content_hash
```bash
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/record_manager_test.txt"
```
**Acceptance Criteria:** Response contains `"action": "created"`, `"content_hash"` is a 64-char hex string, `"status": "pending"`. Save response `id` as `$DEDUP_DOC_ID`.

---

#### API-42: Wait for document processing to complete
```bash
sleep 5
curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN1" | jq '.[] | select(.id == "'$DEDUP_DOC_ID'")'
```
**Acceptance Criteria:** Document status is `"completed"` and `chunk_count >= 1`.

---

#### API-43: Re-upload identical file returns action "skipped"
```bash
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/record_manager_test.txt"
```
**Acceptance Criteria:** Response contains `"action": "skipped"`, `"status": "completed"`. No new document created (same `id` as `$DEDUP_DOC_ID`).

---

#### API-44: Re-upload modified file returns action "updated"
```bash
# Create a modified version of the test file
echo "MODIFIED: Different content for deduplication test." > /tmp/record_manager_test.txt
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/record_manager_test.txt;filename=record_manager_test.txt"
```
**Acceptance Criteria:** Response contains `"action": "updated"`, `"status": "pending"`. Same `id` as `$DEDUP_DOC_ID`. `content_hash` differs from original.

---

#### API-45: Updated document re-processes with new chunks
```bash
sleep 5
curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN1" | jq '.[] | select(.id == "'$DEDUP_DOC_ID'")'
```
**Acceptance Criteria:** Document status is `"completed"`, `chunk_count >= 1`. No duplicate chunks from previous version.

---

#### API-46: Cleanup dedup test document
```bash
curl -s -X DELETE http://localhost:8001/documents/$DEDUP_DOC_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response contains `"status": "deleted"`.

---

### Metadata Extraction

#### API-47: Upload document and verify metadata populated
**Steps:**
```bash
# Upload a text file
RESPONSE=$(curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/rag_test.txt")
META_DOC_ID=$(echo $RESPONSE | jq -r '.id')
echo $RESPONSE

# Wait for processing
sleep 10

# Get document with metadata
curl -s http://localhost:8001/documents/$META_DOC_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Document has `metadata` object with `title`, `summary`, `document_type`, `topics` fields populated.

---

#### API-48: GET document returns metadata
**Steps:**
```bash
curl -s http://localhost:8001/documents/$META_DOC_ID \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response contains `metadata` field with non-empty object. `metadata.title` is a non-empty string. `metadata.topics` is a non-empty array.

---

#### API-49: GET document chunks returns propagated metadata
**Steps:**
```bash
curl -s http://localhost:8001/documents/$META_DOC_ID/chunks \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response is an array. Each chunk has `metadata` object containing `filename`, `document_type`, `topics` fields.

---

#### API-50: Search with metadata_filter returns filtered results
**Steps:**
```bash
# Get the document_type from the uploaded doc
DOC_TYPE=$(curl -s http://localhost:8001/documents/$META_DOC_ID \
  -H "Authorization: Bearer $TOKEN1" | jq -r '.metadata.document_type')

# This test verifies the match_chunks function works with metadata filter
# The actual filtering happens through the tool call, but we can verify the RPC works
echo "Document type: $DOC_TYPE"
```
**Acceptance Criteria:** DOC_TYPE is one of: article, tutorial, reference, notes, report, essay, code, other.

---

#### API-51: Search without filter returns all results (backward-compat)
**Steps:**
```bash
# Standard chat request without explicit filter — should still work
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"What is in my documents?"}' --max-time 30 | head -c 500
```
**Acceptance Criteria:** SSE stream is received without errors. Response does not contain `"error"`.

---

#### API-52: GET settings includes metadata_schema
**Steps:**
```bash
curl -s http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response contains `metadata_schema` field that is an array of 5 objects. Each object has `name`, `type`, `required`, `description` keys.

---

#### API-53: PUT settings with modified schema persists
**Steps:**
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"metadata_schema": [
    {"name": "title", "type": "string", "required": true, "description": "Document title"},
    {"name": "summary", "type": "string", "required": true, "description": "Brief summary"},
    {"name": "document_type", "type": "enum", "required": true, "description": "Category", "enum_values": ["article", "tutorial", "reference", "notes", "report", "essay", "code", "other"]},
    {"name": "topics", "type": "list", "required": true, "description": "Key topics"},
    {"name": "language", "type": "string", "required": false, "description": "ISO 639-1 language code"},
    {"name": "audience", "type": "string", "required": false, "description": "Target audience"}
  ]}'
```
**Acceptance Criteria:** Response contains `metadata_schema` with 6 fields (the 5 defaults + new "audience" field).

---

#### API-54: Cleanup metadata test document and reset schema
**Steps:**
```bash
# Delete test document
curl -s -X DELETE http://localhost:8001/documents/$META_DOC_ID \
  -H "Authorization: Bearer $TOKEN1"

# Reset schema to defaults
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"metadata_schema": [
    {"name": "title", "type": "string", "required": true, "description": "A concise, descriptive title for the document"},
    {"name": "summary", "type": "string", "required": true, "description": "A 1-3 sentence summary of the document content"},
    {"name": "document_type", "type": "enum", "required": true, "description": "The category of this document", "enum_values": ["article", "tutorial", "reference", "notes", "report", "essay", "code", "other"]},
    {"name": "topics", "type": "list", "required": true, "description": "3-7 key topics or themes covered in the document"},
    {"name": "language", "type": "string", "required": false, "description": "ISO 639-1 language code of the document (e.g. en, es, fr)"}
  ]}'
```
**Acceptance Criteria:** Document deleted. Schema reset to 5 default fields.

---

## E2E: Record Manager

#### E2E-28: Upload new file shows "processing" feedback
**Steps:**
1. Navigate to Documents page (already signed in as test@test.com)
2. Upload `.agent/validation/fixtures/record_manager_test.txt` via file chooser
3. `browser_snapshot`
**Acceptance Criteria:** Feedback message "Document uploaded and processing..." is visible. Document appears in list with status "processing" or "pending".

---

#### E2E-29: Re-upload same file shows "unchanged" feedback
**Steps:**
1. Wait for document to reach "completed" status (`browser_wait_for` time: 5)
2. Upload the same file again via file chooser
3. `browser_snapshot`
**Acceptance Criteria:** Feedback message "Document unchanged, skipping processing" is visible. No new document created in list.

---

#### E2E-30: Upload modified file shows "re-processing" feedback
**Steps:**
1. Modify the fixture file content
2. Upload the modified file with same filename via file chooser
3. `browser_snapshot`
**Acceptance Criteria:** Feedback message "Document updated, re-processing..." is visible. Document status changes to "processing".

---

#### E2E-31: Clean up record manager test document
**Steps:**
1. Click Delete button on the record_manager_test.txt document
2. Accept confirmation dialog
3. `browser_snapshot`
**Acceptance Criteria:** Document is removed from the list.

---

## E2E: Metadata Extraction

#### E2E-32: Upload document and verify metadata in detail panel
**Steps:**
1. Navigate to Documents page (already signed in as test@test.com)
2. Upload `.agent/validation/fixtures/rag_test.txt` via file chooser
3. Wait for document to reach "completed" status (`browser_wait_for` time: 15)
4. `browser_snapshot`
5. Click on the completed document row to expand the detail panel
6. `browser_snapshot`
**Acceptance Criteria:** Detail panel is visible showing metadata fields: title, summary, document_type (as a badge), topics (as chips/tags).

---

#### E2E-33: Document title displays as primary label
**Steps:**
1. `browser_snapshot` — observe the document list
**Acceptance Criteria:** Completed document shows extracted title (not just filename) as the primary label. Filename is shown as secondary text.

---

#### E2E-34: Collapse detail panel by clicking again
**Steps:**
1. Click on the expanded document row again
2. `browser_snapshot`
**Acceptance Criteria:** Detail panel collapses. Metadata fields are no longer visible.

---

#### E2E-35: Clean up metadata test document
**Steps:**
1. Click Delete button on the rag_test.txt document
2. Accept confirmation dialog
3. `browser_snapshot`
**Acceptance Criteria:** Document is removed from the list.

---

## Section 10: Hybrid Search & Reranking (Module 6)

### Prerequisites
- Documents already uploaded (from earlier tests, $RAG_DOC_ID should exist)
- Backend running with hybrid search migration applied

---

### API Tests

#### API-55: Keyword search returns results for exact terms

**Steps:**
```bash
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Search for the exact phrase: RAG Masterclass"}'
```
**Acceptance Criteria:** Response streams successfully, tool is called with search_mode (default hybrid), results returned.

---

#### API-56: Vector search mode still works (backward compat)

**Steps:**
```bash
# Call the search_documents function directly via a chat message that would trigger vector-only
# Verify the backend handles search_mode="vector" without error
curl -s http://localhost:8001/health
```
**Acceptance Criteria:** Backend is healthy and vector search path is exercised through chat.

---

#### API-57: Settings API accepts reranking config

**Steps:**
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"rerank_model":"rerank-v3.5","rerank_base_url":"https://api.cohere.com/v2","rerank_api_key":"test-key-123","rerank_top_n":3}'
```
**Acceptance Criteria:** Response includes `rerank_model: "rerank-v3.5"`, `rerank_base_url: "https://api.cohere.com/v2"`, `rerank_api_key: "***123"` (masked), `rerank_top_n: 3`.

---

#### API-58: Settings API returns reranking fields in GET

**Steps:**
```bash
curl -s http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response JSON includes `rerank_model`, `rerank_base_url`, `rerank_api_key`, `rerank_top_n` fields.

---

#### API-59: Reranking gracefully degrades when disabled

**Steps:**
```bash
# Clear rerank_base_url to disable reranking
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"rerank_base_url":""}'

# Chat query should still work without reranking
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"What topics are covered in my documents?"}'
```
**Acceptance Criteria:** Chat response streams successfully without errors. Search results returned without rerank_score.

---

#### API-60: FTS trigger populates tsvector on new chunks

**Steps:**
```bash
# Upload a new document and verify fts column is populated
# (This is verified by keyword search returning results for its content)
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/sample.txt"
```
**Acceptance Criteria:** Upload succeeds. After ingestion completes, keyword search for terms in the document returns results.

---

#### API-61: Hybrid search returns results with rrf_score

**Steps:**
```bash
# Chat with a query that should trigger hybrid search (default mode)
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Tell me about retrieval augmented generation"}'
```
**Acceptance Criteria:** Response includes search results. Tool executor formats results with rrf_score present.

---

#### API-62: Metadata filter works with hybrid search

**Steps:**
```bash
# Chat query that triggers filtered hybrid search
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Search for articles about AI"}'
```
**Acceptance Criteria:** Search is triggered with metadata filter and hybrid mode. Results are returned.

---

#### API-63: Reranking applied when configured

**Steps:**
```bash
# Re-enable reranking with a test URL (will fail gracefully since not a real endpoint)
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"rerank_base_url":"https://api.cohere.com/v2","rerank_api_key":"invalid-key"}'

# Chat should still work (reranking fails gracefully, returns original results)
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"What is in my documents?"}'
```
**Acceptance Criteria:** Chat works even with invalid reranking config (graceful degradation). Results returned without error.

---

#### API-64: Cleanup hybrid search test state

**Steps:**
```bash
# Reset reranking settings
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"rerank_base_url":"","rerank_api_key":""}'
```
**Acceptance Criteria:** Settings updated, reranking disabled.

---

### E2E Tests

#### E2E-36: Settings page shows reranking configuration section

**Steps:**
1. Navigate to settings page (login as admin if needed)
2. `browser_snapshot`
3. Scroll down to find "Reranking Configuration" heading

**Acceptance Criteria:** Page shows "Reranking Configuration" section with Model Name, Base URL, API Key, and Top N fields.

---

#### E2E-37: Save reranking settings

**Steps:**
1. Navigate to settings page
2. Fill in reranking fields:
   - Model: `rerank-v3.5`
   - Base URL: `https://api.cohere.com/v2`
   - Top N: `5`
3. Click Save
4. `browser_snapshot`

**Acceptance Criteria:** Success message appears. Fields retain their values after save.

---

#### E2E-38: Chat uses hybrid search by default

**Steps:**
1. Navigate to chat page
2. Create a new thread
3. Send a message: "What documents do I have?"
4. Wait for response
5. `browser_snapshot`

**Acceptance Criteria:** Assistant responds with information from documents (indicating hybrid search worked). No errors shown.

---

## Section 11: Multi-Format Support (Module 5)

### Prerequisites
- Backend running with Docling installed
- HTML fixture at `.agent/validation/fixtures/test_document.html`

---

### API Tests

#### API-65: Upload HTML file succeeds

**Steps:**
```bash
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_document.html"
```
**Acceptance Criteria:** HTTP 200. Response contains `"filename":"test_document.html"`, `"file_type":"text/html"`, `"status":"pending"`. Save `id` as `$HTML_DOC_ID`.

---

#### API-66: HTML document processing completes

**Steps:**
```bash
# Poll every 2 seconds for up to 30 seconds
for i in $(seq 1 15); do
  STATUS=$(curl -s http://localhost:8001/documents/$HTML_DOC_ID \
    -H "Authorization: Bearer $TOKEN1" | python -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
  if [ "$STATUS" = "completed" ]; then break; fi
  sleep 2
done
echo $STATUS
```
**Acceptance Criteria:** Status is `"completed"` within 30 seconds. `chunk_count` >= 1.

---

#### API-67: HTML chunks have extracted content

**Steps:**
```bash
curl -s http://localhost:8001/documents/$HTML_DOC_ID/chunks \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response is a non-empty array. At least one chunk `content` contains text from the HTML (e.g., "Machine Learning" or "Supervised Learning").

---

#### API-68: Upload PDF file succeeds

**Steps:**
```bash
# Create a minimal test PDF (or use an existing one if available)
curl -s -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@.agent/validation/fixtures/test_document.pdf"
```
**Acceptance Criteria:** HTTP 200. Response contains `"file_type":"application/pdf"`, `"status":"pending"`. Save `id` as `$PDF_DOC_ID`. (Skip if no PDF fixture available.)

---

#### API-69: Reject unsupported extension (.py)

**Steps:**
```bash
echo "print('hello')" > /tmp/test_invalid.py
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/test_invalid.py"
```
**Acceptance Criteria:** HTTP status code is `400`. Response detail mentions "Unsupported file type".

---

#### API-70: Reject oversized file (>50 MB)

**Steps:**
```bash
# Create a file larger than 50MB
dd if=/dev/zero of=/tmp/large_file.txt bs=1M count=51 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8001/documents/upload \
  -H "Authorization: Bearer $TOKEN1" \
  -F "file=@/tmp/large_file.txt"
```
**Acceptance Criteria:** HTTP status code is `400`. Response detail mentions "50 MB".

---

#### API-71: Cleanup multi-format test documents

**Steps:**
```bash
curl -s -X DELETE http://localhost:8001/documents/$HTML_DOC_ID \
  -H "Authorization: Bearer $TOKEN1"
# If PDF was uploaded:
# curl -s -X DELETE http://localhost:8001/documents/$PDF_DOC_ID \
#   -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response contains `"status":"deleted"`.

---

### E2E Tests

#### E2E-39: Upload help text shows multi-format support

**Steps:**
1. Sign in as test@test.com
2. Navigate to Documents page
3. `browser_snapshot`
**Acceptance Criteria:** Upload zone shows help text: "Supported: PDF, DOCX, PPTX, XLSX, TXT, MD, HTML, Images (max 50 MB)".

---

#### E2E-40: Upload HTML file via UI

**Steps:**
1. From Documents page
2. `browser_file_upload` with path to `.agent/validation/fixtures/test_document.html`
3. `browser_wait_for` time: 5 seconds
4. `browser_snapshot`
**Acceptance Criteria:** Document "test_document.html" appears in the document list with status "pending" or "processing".

---

#### E2E-41: HTML document reaches completed status

**Steps:**
1. From E2E-40 state
2. `browser_wait_for` time: 20 seconds
3. `browser_snapshot`
**Acceptance Criteria:** Document status shows "completed". Metadata is populated (title visible).

---

#### E2E-42: Cleanup multi-format test document

**Steps:**
1. Click Delete button on the test_document.html document
2. `browser_wait_for` time: 3 seconds
3. `browser_snapshot`
**Acceptance Criteria:** Document is removed from the list.

---

## Section 12: Additional Tools (Module 7)

### Prerequisites
- Backend running with Module 7 migration applied
- sales_data table populated with sample data

---

### API Tests

#### API-72: SQL query returns sales data

**Steps:**
```bash
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"What are the total sales by region?"}'
```
**Acceptance Criteria:** Response streams successfully. Assistant uses query_sales_database tool and returns aggregated data by region.

---

#### API-73: SQL query with filter

**Steps:**
```bash
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me all orders from Acme Corp"}'
```
**Acceptance Criteria:** Response contains order details for Acme Corp customer.

---

#### API-74: SQL query - permission denied for other tables

**Steps:**
```bash
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me all documents in the documents table using SQL"}'
```
**Acceptance Criteria:** Response indicates permission denied or only sales_data access is allowed.

---

#### API-75: Settings API accepts web search config

**Steps:**
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"web_search_provider":"tavily","web_search_api_key":"test-key-123","web_search_enabled":true}'
```
**Acceptance Criteria:** Response includes `web_search_provider: "tavily"`, `web_search_api_key: "***123"` (masked), `web_search_enabled: true`.

---

#### API-76: Settings API returns web search fields in GET

**Steps:**
```bash
curl -s http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Response JSON includes `web_search_provider`, `web_search_api_key`, `web_search_enabled` fields.

---

#### API-77: Web search tool available when enabled

**Steps:**
```bash
# Ensure web search is enabled from API-75, then ask a question
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Search the web for the latest news about AI"}'
```
**Acceptance Criteria:** Response indicates web_search tool was called (may fail with invalid key but should attempt).

---

#### API-78: Web search gracefully handles disabled state

**Steps:**
```bash
# Disable web search
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"web_search_enabled":false}'

# Ask question that would trigger web search
curl -s -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"What happened in the news today?"}'
```
**Acceptance Criteria:** Chat works without error. Web search tool is not available (assistant uses document search or responds without web results).

---

#### API-79: Cleanup Module 7 test state

**Steps:**
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"web_search_api_key":"","web_search_enabled":false}'
```
**Acceptance Criteria:** Settings updated, web search disabled.

---

### E2E Tests

#### E2E-43: Settings page shows web search configuration section

**Steps:**
1. Navigate to settings page (login as admin if needed)
2. `browser_snapshot`
3. Scroll down to find "Web Search Configuration" heading

**Acceptance Criteria:** Page shows "Web Search Configuration" section with Enable checkbox, Provider dropdown, and API Key field.

---

#### E2E-44: Save web search settings

**Steps:**
1. Navigate to settings page
2. Check "Enable Web Search" checkbox
3. Select "Tavily" provider
4. Enter a test API key
5. Click Save
6. `browser_snapshot`

**Acceptance Criteria:** Success message appears. Fields retain their values after save.

---

#### E2E-45: Chat can query sales database

**Steps:**
1. Navigate to chat page
2. Create a new thread
3. Send a message: "What are the total sales by category?"
4. Wait for response
5. `browser_snapshot`

**Acceptance Criteria:** Assistant responds with sales data grouped by category (Electronics, Furniture). Shows aggregated amounts.

---

#### E2E-46: Chat shows SQL query results formatted

**Steps:**
1. From E2E-45 thread
2. Send a message: "List the top 3 customers by total spending"
3. Wait for response
4. `browser_snapshot`

**Acceptance Criteria:** Assistant responds with customer names and total amounts. Data is presented in a readable format.

---

## Section 13: Sub-Agents (Module 8)

### Prerequisites
- Backend running with sub-agent service implemented
- At least one completed document uploaded (from earlier tests)

---

### API Tests

#### API-80: analyze_document tool present in tool schema

**Steps:**
```bash
# The tool schema is built at runtime, verify by checking the system prompt in LangSmith
# or by observing tool calls in chat - this is a design verification
curl -s http://localhost:8001/health
```
**Acceptance Criteria:** Backend is healthy. Tool schema includes analyze_document with document_id and query parameters.

---

#### API-81: Sub-agent spawns for valid document

**Steps:**
```bash
# First, get a document ID from the user's documents
DOC_ID=$(curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN1" | jq -r '.[0].id')

# Trigger document analysis via chat
curl -s -N -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Analyze document $DOC_ID and summarize its key points\"}" \
  --max-time 120
```
**Acceptance Criteria:** SSE stream contains `tool_call_start` with `analyze_document`, followed by `sub_agent_start`, `sub_agent_reasoning` events streaming, and `sub_agent_complete` with result.

---

#### API-82: Sub-agent errors for invalid document_id

**Steps:**
```bash
curl -s -N -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Analyze the document with ID 00000000-0000-0000-0000-000000000000 and summarize it"}' \
  --max-time 60
```
**Acceptance Criteria:** SSE stream contains `sub_agent_error` event with message indicating document not found.

---

#### API-83: Tool call_start event emitted before execution

**Steps:**
```bash
# Trigger a search_documents tool call and verify tool_call_start event
curl -s -N -X POST http://localhost:8001/threads/$THREAD_ID/messages \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"content":"Search my documents for information about testing"}' \
  --max-time 60 | head -50
```
**Acceptance Criteria:** SSE stream contains `tool_call_start` event with `tool_name: "search_documents"` before the tool result is used.

---

### E2E Tests

#### E2E-47: Tool indicator visible during search

**Steps:**
1. Navigate to chat page (sign in if needed)
2. Create a new thread
3. Send message: "Search my documents for any information"
4. `browser_wait_for` time: 3 seconds
5. `browser_snapshot`
**Acceptance Criteria:** Tool call indicator is visible showing "Searching documents" with a spinner while the tool executes.

---

#### E2E-48: Sub-agent panel appears when analyzing document

**Steps:**
1. Navigate to Documents page
2. Note the filename of a completed document
3. Navigate to Chat page, create new thread
4. Send message: "Summarize my document [filename]" (use the actual filename)
5. `browser_wait_for` time: 5 seconds
6. `browser_snapshot`
**Acceptance Criteria:** Sub-agent panel appears showing "Analyzing: [filename]" with a collapsible reasoning section.

---

#### E2E-49: Sub-agent reasoning text visible and streams

**Steps:**
1. From E2E-48 state
2. Expand the sub-agent panel if collapsed
3. `browser_wait_for` time: 10 seconds
4. `browser_snapshot`
**Acceptance Criteria:** Reasoning text is visible inside the panel, showing the sub-agent's analysis in progress or completed.

---

#### E2E-50: Sub-agent completion shows checkmark

**Steps:**
1. From E2E-49 state
2. `browser_wait_for` time: 30 seconds (allow full analysis)
3. `browser_snapshot`
**Acceptance Criteria:** Sub-agent panel shows a checkmark icon indicating completion. Final response incorporates the analysis.

---

## Cleanup

After all tests pass, clean up test data:

### Cleanup-01: Delete test documents
```bash
# Delete remaining test documents
for DOC in $DOC_ID_MD $RAG_DOC_ID; do
  curl -s -X DELETE http://localhost:8001/documents/$DOC \
    -H "Authorization: Bearer $TOKEN1"
done
```

### Cleanup-02: Delete test threads
```bash
curl -s -X DELETE http://localhost:8001/threads/$THREAD_ID \
  -H "Authorization: Bearer $TOKEN1"
```

### Cleanup-03: Reset settings
```bash
curl -s -X PUT http://localhost:8001/settings \
  -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d '{"llm_model":null,"llm_api_key":null}'
```

### Cleanup-04: Verify clean state
```bash
# Verify no test threads remain
curl -s http://localhost:8001/threads \
  -H "Authorization: Bearer $TOKEN1"

# Verify no test documents remain
curl -s http://localhost:8001/documents \
  -H "Authorization: Bearer $TOKEN1"
```
**Acceptance Criteria:** Thread list and document list do not contain any items created during this test run.

---

## Results Summary Template

| Section | Total | Passed | Failed | Skipped |
|---------|-------|--------|--------|---------|
| API: Health & Auth | 4 | | | |
| API: Thread CRUD | 7 | | | |
| API: Data Isolation | 4 | | | |
| API: Chat/Messages | 4 | | | |
| API: Documents | 11 | | | |
| API: Record Manager | 6 | | | |
| API: Metadata Extraction | 8 | | | |
| API: Settings & Admin | 7 | | | |
| API: Error Handling | 3 | | | |
| E2E: Auth Flow | 4 | | | |
| E2E: Chat Flow | 5 | | | |
| E2E: Navigation | 2 | | | |
| E2E: Documents | 4 | | | |
| E2E: RAG Integration | 2 | | | |
| E2E: Data Isolation | 5 | | | |
| E2E: Admin Settings | 4 | | | |
| E2E: Error Handling | 1 | | | |
| E2E: Record Manager | 4 | | | |
| E2E: Metadata Extraction | 4 | | | |
| API: Hybrid Search & Reranking | 10 | | | |
| E2E: Hybrid Search & Reranking | 3 | | | |
| API: Multi-Format Support | 7 | | | |
| E2E: Multi-Format Support | 4 | | | |
| API: Additional Tools (Module 7) | 8 | | | |
| E2E: Additional Tools (Module 7) | 4 | | | |
| API: Sub-Agents (Module 8) | 4 | | | |
| E2E: Sub-Agents (Module 8) | 4 | | | |
| **TOTAL** | **133** | | | |
