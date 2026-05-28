# Changelog

## Unreleased

## 0.2.0 (2026-05-15)

  * feat(raw-events): Add structured raw-event filters, clickable sender/type chips, and progressive rendering for long raw streams.
  * feat(viewer): Add session search and sticky per-tab scroll restoration.
  * feat(viewer): Highlight conversation search matches, summarize tool results, group timeline events, and add copy/jump actions for last responses and raw events.
  * feat(viewer): Add a floating back-to-top control for long session views.
  * feat(viewer): Add conversation match navigation, searchable timeline filters with Conversation/Raw jumps, Last Response directive hiding, Raw event lookup helpers, session-search clear affordances, and refresh status feedback.
  * fix(viewer): Refresh now reloads the selected session detail and uses the latest rollout token usage in the stats card.
  * fix(raw-events): Make `index:` filters match exact event numbers.

## 0.1.0 (2026-05-14)

  * feat(viewer): Add the initial local Codex session viewer with session metadata, timeline, conversation, last-response, tool usage, token usage, and live rollout updates.
  * feat(raw-events): Replace the plain raw JSON dump with searchable, expandable raw event cards that show event-type summaries, sender/source badges, compact previews, formatted payloads, and sender-colored visual grouping.
  * feat(version): Expose the package version in the CLI, server health response, and web header.
  * docs: Add release history tracking in `history.md` and document the changelog in the README files.
