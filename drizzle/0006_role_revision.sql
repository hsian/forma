ALTER TABLE project_roles ADD COLUMN revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN legacy_admin_delete integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE projects SET legacy_admin_delete = 1;
