ALTER TABLE rd_items ADD COLUMN owner_ids text NOT NULL DEFAULT '[]';
--> statement-breakpoint
UPDATE rd_items SET owner_ids = json_array(owner_id) WHERE owner_id IS NOT NULL;
