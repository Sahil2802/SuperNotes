# Flashcard review with spaced repetition: design

## Intent
Live Notes already generates question/answer flashcards for each lecture (the `extract` stage, saved in `extract.json`). The user's pain is that they still make flashcards by hand and review by re-reading. Goal: study entirely inside Live Notes. Review the generated cards on a spaced-repetition schedule, and fix the cards when the model gets them wrong.

## Goals
- Edit, delete and add flashcards on a lecture's page (none of this exists today).
- A Review screen: show the question, reveal the answer, rate Again / Hard / Good / Easy.
- Per-card scheduling: each card has its own next-review date; the app shows how many cards are due today.
- Two ways to start a review: the main Review button loads all due cards from every lecture mixed together; a course picker (and a "Review this lecture" button on the lecture page) loads only that course's or lecture's due cards.
- New cards are limited to 20 per day (default). The limit is a setting.

## Non-goals
- Search, ask-your-notes, bookmarks, cloze (fill-in-the-blank) cards. Plain question/answer only.
- Replacing the Anki export. It stays as is.
- Statistics, streaks, charts, multi-device sync.

## Anti-goals
- Editing or reviewing cards must never lose data. A lecture being re-processed must not wipe the user's edits or review history.
- No new heavyweight dependencies.

## Constraints
- Existing stack: Python FastAPI engine (`engine/`) storing per-lecture files under `<data_dir>/lectures/<id>/`, and an Electron + React desktop app (`desktop/`). Match existing patterns (Store, token-authed endpoints, `api/client.ts`).
- Lectures have an optional `course` string. Lectures without one are grouped as "No course".

## Decisions made with the user
- Study happens inside Live Notes, not in Anki.
- Full spaced repetition, not simple flip-through.
- Plain question/answer cards.
- Review by daily queue AND by course/lecture.
- Daily new-card limit defaults to 20.

## Calls I made (user hasn't ruled on these)
- Scheduling algorithm: SM-2 (simple, well known). Upgrade to FSRS later if wanted.
- Storage: per-card scheduling state saved in the engine's own files (no new database), alongside the lecture's data.
- Lecture page gets the editing UI and a "Review this lecture" button.

- Re-processing: cards are imported from the model once. A later run only adds genuinely new cards (matched by question text) and never touches existing, edited or deleted ones. A card the user deleted stays deleted.
- Anki export and the notes file use the edited card set, so they match what the user sees.
- New-card limit: one global budget per day (20, from `config.yaml`, no settings screen). It applies to every review view, including a single course or lecture, so "Review this lecture" with 50 new cards shows up to the remaining budget. Reviewed cards that are due are never capped.
- "Due today" counts cards already learned and due, plus new cards up to the remaining budget. New cards are available as soon as the lecture finishes processing.
- Ratings map to SM-2 grades Again=1, Hard=3, Good=4, Easy=5. An Again card comes back later in the same session; the queue is a list held in the app, with each rating saved to the engine as it happens.
- Writes to a lecture's card file go through the existing Store lock with atomic replace, like `status.json`.

## Left to the builder
- Exact file/endpoint shapes, and how cards migrate from `extract.json` into editable, schedulable cards.
- How re-running `process` on a lecture avoids clobbering edited/reviewed cards.
- Whether the new-card limit counts cards introduced "today" per day or per course; what "today" means (local midnight is fine).
- Review screen layout, keyboard shortcuts, empty states ("nothing due").
