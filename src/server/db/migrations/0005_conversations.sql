-- 0005_conversations
-- Conversations inbox: human replies and assignment.
--
-- * messages.author_id        set when a team member replies from the inbox.
--                             Human replies keep role = 'assistant' so model
--                             context stays coherent; the UI renders them as
--                             "Team" whenever author_id is present.
-- * conversations.assigned_to team member responsible for the thread.
--
-- Both columns reference users and are nulled when the user is deleted so
-- conversation history is never lost. RLS policies from 0001 already cover
-- these tables (policies are row-based, so new columns need no changes).

ALTER TABLE messages
  ADD COLUMN author_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN assigned_to uuid REFERENCES users(id) ON DELETE SET NULL;

-- Inbox filters: status chips and "assigned to me" combine with the default
-- ordering on last_message_at.
CREATE INDEX conversations_workspace_status_idx
  ON conversations(workspace_id, status, last_message_at DESC NULLS LAST);

CREATE INDEX conversations_assigned_to_idx
  ON conversations(assigned_to)
  WHERE assigned_to IS NOT NULL;
