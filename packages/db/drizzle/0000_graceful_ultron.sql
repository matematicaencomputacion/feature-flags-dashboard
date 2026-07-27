CREATE TABLE `flags` (
	`key` text PRIMARY KEY NOT NULL,
	`lifecycle` text DEFAULT 'experimental' NOT NULL,
	`safe_default` text DEFAULT 'off' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `environment_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flag_key` text NOT NULL,
	`environment` text NOT NULL,
	`default_on` integer DEFAULT false NOT NULL,
	`rollout_percent` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`flag_key`) REFERENCES `flags`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `env_rules_flag_env` ON `environment_rules` (`flag_key`,`environment`);--> statement-breakpoint
CREATE TABLE `tenant_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flag_key` text NOT NULL,
	`environment` text NOT NULL,
	`tenant_id` text NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`flag_key`) REFERENCES `flags`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_override_unique` ON `tenant_overrides` (`flag_key`,`environment`,`tenant_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flag_key` text NOT NULL,
	`by` text NOT NULL,
	`at` text NOT NULL,
	`summary` text NOT NULL
);
