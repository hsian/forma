CREATE TABLE `page_blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `version_asset_blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`data` text NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `version_assets` (
	`version_id` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`version_id`, `hash`),
	FOREIGN KEY (`version_id`) REFERENCES `project_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hash`) REFERENCES `version_asset_blobs`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `version_pages` (
	`version_id` text NOT NULL,
	`page_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`position` integer NOT NULL,
	`content_hash` text NOT NULL,
	PRIMARY KEY(`version_id`, `page_id`),
	FOREIGN KEY (`version_id`) REFERENCES `project_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_hash`) REFERENCES `page_blobs`(`hash`) ON UPDATE no action ON DELETE no action
);
