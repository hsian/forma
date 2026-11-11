CREATE TABLE ai_conversations (
 id text PRIMARY KEY NOT NULL,
 page_id text NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
 title text NOT NULL DEFAULT '新对话',
 archived integer NOT NULL DEFAULT 0,
 created_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_conversations_current ON ai_conversations(page_id) WHERE archived = 0;
--> statement-breakpoint
ALTER TABLE ai_messages ADD conversation_id text REFERENCES ai_conversations(id) ON DELETE CASCADE;
--> statement-breakpoint
INSERT INTO ai_conversations (id, page_id, title, created_at)
SELECT 'legacy-' || page_id, page_id, substr(min(content), 1, 40), min(created_at) FROM ai_messages GROUP BY page_id;
--> statement-breakpoint
UPDATE ai_messages SET conversation_id = 'legacy-' || page_id;
--> statement-breakpoint
CREATE INDEX ai_messages_conversation ON ai_messages(conversation_id, created_at);
