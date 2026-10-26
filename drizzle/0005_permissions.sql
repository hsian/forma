ALTER TABLE users ADD COLUMN enabled integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN can_create_project integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE project_members ADD COLUMN custom_role_id text;
--> statement-breakpoint
CREATE TABLE project_roles (id text PRIMARY KEY NOT NULL, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name text NOT NULL, description text NOT NULL, permissions text NOT NULL);
--> statement-breakpoint
CREATE TABLE permission_audit (id text PRIMARY KEY NOT NULL, project_id text, actor text NOT NULL, target text NOT NULL, action text NOT NULL, detail text NOT NULL, created_at integer NOT NULL);
--> statement-breakpoint
CREATE INDEX permission_audit_project_time ON permission_audit(project_id, created_at);
