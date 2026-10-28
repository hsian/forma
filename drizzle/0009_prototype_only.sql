-- Retain the removed module data as independent, read-only archive tables.
CREATE TABLE retired_rd_workflows AS SELECT * FROM rd_workflows;
--> statement-breakpoint
CREATE TABLE retired_rd_iterations AS SELECT * FROM rd_iterations;
--> statement-breakpoint
CREATE TABLE retired_rd_items AS SELECT * FROM rd_items;
--> statement-breakpoint
CREATE TABLE retired_rd_events AS SELECT * FROM rd_events;
--> statement-breakpoint
CREATE TABLE retired_rd_prototype_links AS SELECT * FROM rd_prototype_links;
--> statement-breakpoint
CREATE TABLE retired_rd_attachments AS SELECT * FROM rd_attachments;
--> statement-breakpoint
DROP TABLE rd_attachments;
--> statement-breakpoint
DROP TABLE rd_prototype_links;
--> statement-breakpoint
DROP TABLE rd_events;
--> statement-breakpoint
UPDATE rd_items SET parent_id = NULL;
--> statement-breakpoint
DROP TABLE rd_items;
--> statement-breakpoint
DROP TABLE rd_iterations;
--> statement-breakpoint
DROP TABLE rd_workflows;
--> statement-breakpoint
UPDATE project_members SET role = 'viewer', custom_role_id = NULL WHERE custom_role_id IN ('product','developer','tester');
--> statement-breakpoint
UPDATE project_roles SET permissions = (SELECT json_group_array(value) FROM json_each(project_roles.permissions) WHERE value IN ('prototype.read','prototype.edit','page.manage','page.delete','sketch.import','version.copy','version.publish','version.delete','project.update','project.delete','member.manage')), revision = revision + 1 WHERE EXISTS (SELECT 1 FROM json_each(project_roles.permissions) WHERE value NOT IN ('prototype.read','prototype.edit','page.manage','page.delete','sketch.import','version.copy','version.publish','version.delete','project.update','project.delete','member.manage'));
