CREATE TABLE `design_ai_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `design_id` text NOT NULL REFERENCES `page_design_boards`(`id`) ON DELETE cascade,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `status` text NOT NULL,
  `provider` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `design_ai_messages_design_id` ON `design_ai_messages` (`design_id`, `created_at`);
