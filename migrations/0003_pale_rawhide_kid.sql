PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`definition_id` integer NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`model` text DEFAULT 'claude-3-5-sonnet' NOT NULL,
	`monthly_budget` real DEFAULT 50 NOT NULL,
	`spent_this_month` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`manager_id` integer,
	`goal` text,
	`heartbeat_schedule` text DEFAULT '*/30 * * * *' NOT NULL,
	`last_heartbeat` text,
	`tasks_completed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`definition_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "tenant_id", "definition_id", "display_name", "role", "model", "monthly_budget", "spent_this_month", "status", "manager_id", "goal", "heartbeat_schedule", "last_heartbeat", "tasks_completed") SELECT "id", "tenant_id", "definition_id", "display_name", "role", "model", "monthly_budget", "spent_this_month", "status", "manager_id", "goal", "heartbeat_schedule", "last_heartbeat", "tasks_completed" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agents_tenant_id_idx` ON `agents` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`parent_goal_id` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_goals`("id", "tenant_id", "title", "description", "status", "parent_goal_id", "progress") SELECT "id", "tenant_id", "title", "description", "status", "parent_goal_id", "progress" FROM `goals`;--> statement-breakpoint
DROP TABLE `goals`;--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;--> statement-breakpoint
CREATE INDEX `goals_tenant_id_idx` ON `goals` (`tenant_id`);