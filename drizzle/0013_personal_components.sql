CREATE TABLE personal_components (
  id text PRIMARY KEY NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  document text NOT NULL,
  revision integer DEFAULT 1 NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX personal_components_owner_idx ON personal_components(owner_id);
