CREATE TABLE `page_design_settings` (
  `page_id` text PRIMARY KEY NOT NULL REFERENCES `pages`(`id`) ON DELETE cascade,
  `required` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_design_boards` (
  `id` text PRIMARY KEY NOT NULL,
  `page_id` text NOT NULL REFERENCES `pages`(`id`) ON DELETE cascade,
  `name` text NOT NULL,
  `content` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_design_boards_page_id` ON `page_design_boards` (`page_id`);
