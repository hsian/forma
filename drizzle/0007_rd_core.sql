CREATE TABLE rd_workflows (id text PRIMARY KEY NOT NULL, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind text NOT NULL, version integer NOT NULL, definition text NOT NULL, created_at integer NOT NULL, UNIQUE(project_id,kind,version));
--> statement-breakpoint
CREATE TABLE rd_iterations (id text PRIMARY KEY NOT NULL, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name text NOT NULL, goal text NOT NULL, start_date text NOT NULL, end_date text NOT NULL, status text NOT NULL, revision integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE rd_items (id text PRIMARY KEY NOT NULL, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind text NOT NULL, number integer NOT NULL, key text NOT NULL, title text NOT NULL, description text NOT NULL, acceptance text NOT NULL, status text NOT NULL, workflow_version integer NOT NULL, owner_id text REFERENCES users(id), tester_id text REFERENCES users(id), creator_id text NOT NULL REFERENCES users(id), parent_id text REFERENCES rd_items(id), iteration_id text REFERENCES rd_iterations(id), priority text NOT NULL, severity text NOT NULL, resolution text NOT NULL, found_version text NOT NULL, fix_version text NOT NULL, due_date text NOT NULL, estimate integer NOT NULL, spent integer NOT NULL, blocked integer NOT NULL, blocked_reason text NOT NULL, revision integer NOT NULL, deleted_at integer, completed_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, UNIQUE(project_id,kind,number));
--> statement-breakpoint
CREATE INDEX rd_items_project_kind ON rd_items(project_id,kind,deleted_at);
--> statement-breakpoint
CREATE INDEX rd_items_parent ON rd_items(parent_id);
--> statement-breakpoint
CREATE TABLE rd_events (id text PRIMARY KEY NOT NULL, item_id text NOT NULL REFERENCES rd_items(id) ON DELETE CASCADE, actor text NOT NULL, action text NOT NULL, detail text NOT NULL, comment text NOT NULL, created_at integer NOT NULL);
--> statement-breakpoint
CREATE INDEX rd_events_item ON rd_events(item_id,created_at);
--> statement-breakpoint
CREATE TABLE rd_prototype_links (id text PRIMARY KEY NOT NULL, item_id text NOT NULL REFERENCES rd_items(id) ON DELETE CASCADE, version_id text NOT NULL REFERENCES project_versions(id), page_id text NOT NULL, annotation_id text, version_name text NOT NULL, page_name text NOT NULL, annotation_title text NOT NULL, dialog_id text, created_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE rd_attachments (id text PRIMARY KEY NOT NULL, item_id text NOT NULL REFERENCES rd_items(id) ON DELETE CASCADE, name text NOT NULL, bytes integer NOT NULL, data text NOT NULL, actor text NOT NULL, created_at integer NOT NULL);
