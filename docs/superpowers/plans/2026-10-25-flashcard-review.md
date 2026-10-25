# Flashcard Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit/add/delete a lecture's flashcards and study them in a Review screen with SM-2 spaced repetition, by daily queue, course, or lecture.

**Architecture:** A new `engine/cards.py` holds pure card logic (import, SM-2, queue). `Store` persists cards per lecture in `cards.json` and a daily new-card counter in `<data_dir>/review.json`. New FastAPI endpoints expose card CRUD and review; the React app gets editing on the Flashcards tab and a `Review` screen.

**Tech Stack:** Python FastAPI + pytest (`cd engine && uv run pytest`), Electron + React + @tanstack/react-query (`cd desktop && npm run build` typechecks; the desktop has no test runner).

**Spec:** `docs/superpowers/specs/2026-10-25-flashcard-review-design.md`

## Global Constraints

- Plain question/answer cards only; no cloze.
- SM-2 with ratings Again=1, Hard=3, Good=4, Easy=5. A grade below 3 sets reps=0, interval=1 day and leaves the ease factor unchanged.
- New-card limit: `new_cards_per_day`, default 20, in `config.yaml` (add to `DEFAULT_CONFIG`). No settings screen. One global budget per local day, applied to every review view (daily queue, course, lecture). Due review cards are never capped.
- "Today" is the local date.
- Cards from the model are imported once; a re-run only adds questions never seen before (matched by `question.strip().lower()`). A deleted card stays deleted.
- Anki export and `notes.md` use the edited card set.
- Writes go through the Store lock with atomic replace (same as `status.json`).
- No new dependencies.

## Review Focus

- Deleting a model card, then re-processing the lecture: the card must not come back (Task 1, Task 2).
- Editing a card to a question that matches a deleted one: allowed, no crash (Task 1).
- Lecture with no `course`: reachable as the "No course" group (Task 2, Task 4).
- Review with nothing due: shows an empty state, not a blank screen (Task 4).
- Rating the same new card twice in one session (Again, then Good): counts once against the daily budget (Task 1).
- Lectures processed before this feature (only `extract.json`, no `cards.json`): cards still appear and are editable (Task 1).

---

### Task 1: Card logic and storage

**Files:**
- Create: `engine/cards.py`
- Modify: `engine/store.py` (config default, card persistence)
- Test: `engine/tests/test_cards.py`

**Interfaces:**
- Produces in `cards.py`:
  - `Card = dict` with keys `id: str, question: str, answer: str, ef: float, reps: int, interval: int, due: str | None` (ISO date, `None` = new).
  - `merge(file: dict, extracted: list[dict]) -> dict` where `file = {"cards": [Card], "seen": [str]}`; adds cards for unseen questions (new: `ef=2.5, reps=0, interval=0, due=None`, `id=uuid4().hex[:8]`), records them in `seen`, returns the file.
  - `grade(card: Card, g: int, today: date) -> Card` (SM-2, returns an updated copy).
  - `is_new(card) -> bool`, `is_due(card, today: date) -> bool` (`due <= today`).
  - `queue(entries: list[tuple[str, Card]], today: date, new_left: int) -> list[tuple[str, Card]]`: entries are `(lecture_id, card)`; returns all due non-new cards, then new cards up to `new_left`.
- Produces on `Store`:
  - `cards(lid) -> list[Card]`: loads `cards.json`; if missing and `extract.json` exists, imports from it first and saves.
  - `sync_cards(lid)`: `merge` of `extract.json` flashcards into `cards.json` and saves.
  - `edit_cards(lid, fn)`: under the lock, loads the file, calls `fn(file)` to mutate it, saves, returns `fn`'s result.
  - `new_today() -> int` and `add_new_today(n: int = 1)`: counter in `<data_dir>/review.json` as `{"date": ISO, "new": int}`, reset when the date differs.

- [ ] **Step 1: Write the failing tests** in `engine/tests/test_cards.py`: `test_merge_adds_only_unseen_questions` (second merge with one old and one new question adds one card), `test_deleted_card_stays_deleted_after_merge`, `test_grade_again_resets_interval_and_keeps_ef` (g=1: reps 0, interval 1, ef unchanged), `test_grade_good_sequence` (g=4 three times from new gives intervals 1, 6, then `round(6*ef)`), `test_grade_easy_raises_ef_and_hard_lowers_it` (g=5 raises ef above 2.5; g=3 lowers it; ef never below 1.3), `test_queue_caps_new_cards_not_due_cards` (3 due, 5 new, `new_left=2` returns 5), `test_store_imports_extract_json_when_no_cards_file` (write `extract.json` via `write_json`, `Store.cards(lid)` returns those cards), `test_new_today_resets_on_new_date`.
- [ ] **Step 2: Run to verify failure**

Run: `cd engine && uv run pytest tests/test_cards.py -v`
Expected: FAIL (`No module named 'cards'`).

- [ ] **Step 3: Implement `engine/cards.py`** per the signatures above. SM-2: for g>=3, `interval = 1 if reps==0 else 6 if reps==1 else round(interval*ef)`, `reps += 1`, `ef = max(1.3, ef + 0.1 - (5-g)*(0.08+(5-g)*0.02))`; `due = today + interval days`.
- [ ] **Step 4: Implement the Store methods and add `"new_cards_per_day": 20` to `DEFAULT_CONFIG`** in `engine/store.py`. Reuse the tmp-then-replace write used by `save`; factor the retry loop into one helper if it avoids duplication.
- [ ] **Step 5: Run to verify pass**

Run: `cd engine && uv run pytest tests/test_cards.py tests/test_store.py -v`
Expected: all PASS.
- [ ] **Step 6: Commit** `git add engine/cards.py engine/store.py engine/tests/test_cards.py && git commit -m "feat: card scheduling and per-lecture card storage"`

---

### Task 2: Endpoints and pipeline integration

**Files:**
- Modify: `engine/app.py`, `engine/pipeline.py`
- Test: `engine/tests/test_review.py`; update `engine/tests/test_pipeline.py` only if an assertion breaks.

**Interfaces:**
- Consumes: Task 1's `Store.cards/sync_cards/edit_cards/new_today/add_new_today`, `cards.grade/queue/is_new/is_due`.
- Produces (all token-authed like existing endpoints):
  - `GET /lectures/{lid}`: `flashcards` is now the list of cards including `id` (replace the `extract.json` value with `store.cards(lid)`).
  - `POST /lectures/{lid}/cards` body `{question, answer}` → the new card.
  - `PATCH /lectures/{lid}/cards/{cid}` body `{question?, answer?}` → the card; 404 if unknown.
  - `DELETE /lectures/{lid}/cards/{cid}` → `{"ok": true}`.
  - `GET /review/queue?course=&lecture=` → `{"cards": [{lecture_id, title, course, card}], "due": int, "new_left": int}`. `course` absent = all; `course=""` = lectures with no course. `lecture` filters to one lecture. Only lectures with state `ready` take part.
  - `GET /review/courses` → `{"due": int, "courses": [{"course": str | None, "due": int}]}` (due = due reviews plus new cards allowed by the remaining budget; the same number the queue would hold).
  - `POST /review/answer` body `{lecture_id, card_id, grade}` (grade in 1,3,4,5; else 422) → the updated card; if the card was new, `add_new_today()`.
- Card mutations on a `ready` lecture rewrite `notes.md` and `flashcards.apkg`. Expose one function in `pipeline.py`, `write_outputs(s: Store, lid: str)`, which `do_assemble` also uses, reading the cards from `s.cards(lid)` instead of `extract.json["flashcards"]` (terms/actions still come from `extract.json`).
- `do_extract` calls `s.sync_cards(lid)` after writing `extract.json`.

- [ ] **Step 1: Write the failing tests** in `engine/tests/test_review.py` using `TestClient(create_app("secret", tmp_path))` and lectures seeded straight through `Store` (`create`, `write_json("extract.json")`, `update(state="ready")`): `test_card_crud_roundtrip`, `test_reprocess_keeps_edits_and_deletes` (delete a card, call `store.sync_cards` again with the same extract, card absent), `test_queue_filters_by_course_lecture_and_no_course`, `test_queue_respects_daily_new_limit` (config limit set to 2 via `config.yaml`, 5 new cards, queue has 2), `test_answer_updates_schedule_and_counts_new_once` (Again then Good on a new card: `review.json` new == 1), `test_answer_rejects_bad_grade` (422), `test_edit_rewrites_anki_and_notes` (after PATCH, `notes.md` contains the new question), `test_courses_endpoint_counts`.
- [ ] **Step 2: Run to verify failure**

Run: `cd engine && uv run pytest tests/test_review.py -v`
Expected: FAIL (404s on the new routes).

- [ ] **Step 3: Implement the endpoints in `engine/app.py` and `write_outputs`/`sync_cards` wiring in `engine/pipeline.py`** per the Interfaces block. Refuse card writes with 409 while the lecture is in `BUSY` states, like `delete`.
- [ ] **Step 4: Run the whole engine suite**

Run: `cd engine && uv run pytest -v`
Expected: all PASS (including the existing `test_pipeline.py`).
- [ ] **Step 5: Commit** `git add engine docs && git commit -m "feat: card CRUD and review endpoints"`

---

### Task 3: Card editing on the lecture page

**Files:**
- Modify: `desktop/src/api/client.ts`, `desktop/src/screens/LectureDetail.tsx`

**Interfaces:**
- Consumes: Task 2 endpoints.
- Produces in `client.ts`: `export type Card = { id: string; question: string; answer: string }`; `Detail.flashcards: Card[]`; `api.addCard(id, {question, answer})`, `api.editCard(id, cid, patch)`, `api.deleteCard(id, cid)`; plus the review types/calls Task 4 needs: `ReviewCard = { lecture_id: string; title: string; course: string | null; card: Card }`, `api.queue(f: {course?: string | null; lecture?: string})` → `{cards: ReviewCard[]; due: number; new_left: number}`, `api.reviewCourses()` → `{due: number; courses: {course: string | null; due: number}[]}`, `api.answer(lecture_id, card_id, grade: 1|3|4|5)`. Use `""` for the no-course filter and omit `course` for all.

- [ ] **Step 1: Add the types and `api` methods** above to `client.ts`.
- [ ] **Step 2: Extend `Flashcards` in `LectureDetail.tsx`**: each card keeps its click-to-flip behaviour and gains Edit and Delete controls (delete asks `confirm`); Edit swaps the card for two text inputs with Save/Cancel; an "Add card" form sits above the grid. Mutations invalidate `["lecture", id]` (same pattern as `act`). Editing is disabled while the lecture is busy. Add a "Review this lecture" button (enabled when `ready` and cards exist) that calls a new `review` prop `(lectureId: string) => void`; add that prop to `LectureDetail`.
- [ ] **Step 3: Verify**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json`
Expected: no errors apart from the `LectureDetail` call site in `App.tsx`, which Task 4 fixes (or pass a temporary no-op there).
- [ ] **Step 4: Commit** `git add desktop && git commit -m "feat: edit, add and delete flashcards"`

---

### Task 4: Review screen

**Files:**
- Create: `desktop/src/screens/Review.tsx`
- Modify: `desktop/src/App.tsx`

**Interfaces:**
- Consumes: Task 3's `api.queue/reviewCourses/answer`.
- Produces: `export default function Review({ lecture, back }: { lecture?: string; back: () => void })`. `App.tsx` `View` gains `{ name: "review"; lecture?: string }`; a "Review (N)" header button (N from `api.reviewCourses().due`, polled via react-query) opens the daily queue; `LectureDetail`'s `review` prop opens `{ name: "review", lecture: id }`.

- [ ] **Step 1: Implement `Review.tsx`.** Layout: a course select (All courses / each course / No course, from `reviewCourses`; hidden when `lecture` is set) and a progress line ("N left"). Body: question; "Show answer" button (Space); then four rating buttons Again/Hard/Good/Easy (keys 1-4) that call `api.answer` with 1/3/4/5. The session queue is a local array fetched once per filter: Again moves the card to the end of the array, any other rating removes it. Changing the filter refetches. Empty state: "Nothing due. Come back later." (and, when `new_left` is 0, mention the daily new-card limit was reached).
- [ ] **Step 2: Wire `App.tsx`** (view, header button with due count, `LectureDetail` `review` prop). Invalidate `["review"]` queries when leaving the screen so the count refreshes.
- [ ] **Step 3: Verify build**

Run: `cd desktop && npm run build`
Expected: exits 0.
- [ ] **Step 4: Manual check** with `npm run dev`: open a ready lecture, edit/add/delete a card, press Review this lecture, rate cards with mouse and keys, confirm an Again card returns later in the session, and that a second visit shows "Nothing due". Say so explicitly if the app could not be launched.
- [ ] **Step 5: Commit** `git add desktop && git commit -m "feat: spaced-repetition review screen"`
