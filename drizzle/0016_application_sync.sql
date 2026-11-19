CREATE TABLE `application_sync_state` (
  `project_id` text PRIMARY KEY NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `revision` integer DEFAULT 1 NOT NULL,
  `published_revision` integer DEFAULT 0 NOT NULL,
  `attempted_at` integer,
  `error` text,
  `warning` text,
  `source_files` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER application_document_insert AFTER INSERT ON documents
BEGIN
  INSERT INTO application_sync_state (project_id)
    SELECT p.project_id FROM pages p JOIN projects a ON a.id = p.project_id
    WHERE p.id = NEW.page_id AND a.application IS NOT NULL
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER application_document_update AFTER UPDATE OF content, revision ON documents
BEGIN
  INSERT INTO application_sync_state (project_id)
    SELECT p.project_id FROM pages p JOIN projects a ON a.id = p.project_id
    WHERE p.id = NEW.page_id AND a.application IS NOT NULL
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER application_page_insert AFTER INSERT ON pages
BEGIN
  INSERT INTO application_sync_state (project_id)
    SELECT id FROM projects WHERE id = NEW.project_id AND application IS NOT NULL
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER application_page_update AFTER UPDATE OF name, parent_id, position ON pages
BEGIN
  INSERT INTO application_sync_state (project_id)
    SELECT id FROM projects WHERE id = NEW.project_id AND application IS NOT NULL
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER application_page_delete AFTER DELETE ON pages
BEGIN
  INSERT INTO application_sync_state (project_id)
    SELECT id FROM projects WHERE id = OLD.project_id AND application IS NOT NULL
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER application_project_rename AFTER UPDATE OF name ON projects
WHEN NEW.application IS NOT NULL
BEGIN
  INSERT INTO application_sync_state (project_id) VALUES (NEW.id)
    ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
INSERT INTO application_sync_state (project_id) SELECT id FROM projects WHERE application IS NOT NULL;
