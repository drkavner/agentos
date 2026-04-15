PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`agent_id` integer,
	`agent_name` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`detail` text,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "tenant_id", "agent_id", "agent_name", "action", "entity", "entity_id", "detail", "tokens_used", "cost", "created_at") SELECT "id", "tenant_id", "agent_id", "agent_name", "action", "entity", "entity_id", "detail", "tokens_used", "cost", "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
CREATE INDEX `audit_log_tenant_id_idx` ON `audit_log` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`channel_type` text DEFAULT 'team' NOT NULL,
	`sender_agent_id` integer,
	`sender_name` text DEFAULT 'System' NOT NULL,
	`sender_emoji` text DEFAULT '🤖' NOT NULL,
	`content` text NOT NULL,
	`message_type` text DEFAULT 'chat' NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "tenant_id", "channel_id", "channel_type", "sender_agent_id", "sender_name", "sender_emoji", "content", "message_type", "metadata", "created_at") SELECT "id", "tenant_id", "channel_id", "channel_type", "sender_agent_id", "sender_name", "sender_emoji", "content", "message_type", "metadata", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `messages_tenant_channel_idx` ON `messages` (`tenant_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`assigned_agent_id` integer,
	`created_by_id` integer,
	`team_id` integer,
	`goal_tag` text,
	`estimated_tokens` integer,
	`actual_tokens` integer,
	`due_date` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "tenant_id", "title", "description", "status", "priority", "assigned_agent_id", "created_by_id", "team_id", "goal_tag", "estimated_tokens", "actual_tokens", "due_date", "completed_at", "created_at") SELECT "id", "tenant_id", "title", "description", "status", "priority", "assigned_agent_id", "created_by_id", "team_id", "goal_tag", "estimated_tokens", "actual_tokens", "due_date", "completed_at", "created_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_tenant_id_idx` ON `tasks` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `tasks_tenant_status_idx` ON `tasks` (`tenant_id`,`status`);--> statement-breakpoint
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
	FOREIGN KEY (`definition_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`manager_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "tenant_id", "definition_id", "display_name", "role", "model", "monthly_budget", "spent_this_month", "status", "manager_id", "goal", "heartbeat_schedule", "last_heartbeat", "tasks_completed") SELECT "id", "tenant_id", "definition_id", "display_name", "role", "model", "monthly_budget", "spent_this_month", "status", "manager_id", "goal", "heartbeat_schedule", "last_heartbeat", "tasks_completed" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
CREATE INDEX `agents_tenant_id_idx` ON `agents` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`parent_goal_id` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_goals`("id", "tenant_id", "title", "description", "status", "parent_goal_id", "progress") SELECT "id", "tenant_id", "title", "description", "status", "parent_goal_id", "progress" FROM `goals`;--> statement-breakpoint
DROP TABLE `goals`;--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;--> statement-breakpoint
CREATE INDEX `goals_tenant_id_idx` ON `goals` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`agent_id` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_team_members`("id", "team_id", "agent_id") SELECT "id", "team_id", "agent_id" FROM `team_members`;--> statement-breakpoint
DROP TABLE `team_members`;--> statement-breakpoint
ALTER TABLE `__new_team_members` RENAME TO `team_members`;--> statement-breakpoint
CREATE INDEX `team_members_team_id_idx` ON `team_members` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_members_agent_id_idx` ON `team_members` (`agent_id`);--> statement-breakpoint
CREATE TABLE `__new_teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT '#4f98a3' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_teams`("id", "tenant_id", "name", "description", "color") SELECT "id", "tenant_id", "name", "description", "color" FROM `teams`;--> statement-breakpoint
DROP TABLE `teams`;--> statement-breakpoint
ALTER TABLE `__new_teams` RENAME TO `teams`;--> statement-breakpoint
CREATE INDEX `teams_tenant_id_idx` ON `teams` (`tenant_id`);--> statement-breakpoint

-- Clean up legacy rows that would violate new FK constraints
UPDATE `messages` SET `sender_agent_id` = NULL
WHERE `sender_agent_id` IS NOT NULL
  AND `sender_agent_id` NOT IN (SELECT `id` FROM `agents`);--> statement-breakpoint

UPDATE `tasks` SET `assigned_agent_id` = NULL
WHERE `assigned_agent_id` IS NOT NULL
  AND `assigned_agent_id` NOT IN (SELECT `id` FROM `agents`);--> statement-breakpoint

UPDATE `tasks` SET `created_by_id` = NULL
WHERE `created_by_id` IS NOT NULL
  AND `created_by_id` NOT IN (SELECT `id` FROM `agents`);--> statement-breakpoint

UPDATE `tasks` SET `team_id` = NULL
WHERE `team_id` IS NOT NULL
  AND `team_id` NOT IN (SELECT `id` FROM `teams`);--> statement-breakpoint

UPDATE `audit_log` SET `agent_id` = NULL
WHERE `agent_id` IS NOT NULL
  AND `agent_id` NOT IN (SELECT `id` FROM `agents`);--> statement-breakpoint

DELETE FROM `team_members`
WHERE `team_id` NOT IN (SELECT `id` FROM `teams`)
   OR `agent_id` NOT IN (SELECT `id` FROM `agents`);--> statement-breakpoint

PRAGMA foreign_keys=ON;