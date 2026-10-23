CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
