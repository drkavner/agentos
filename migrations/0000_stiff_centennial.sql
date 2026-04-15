CREATE TABLE `agent_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`division` text NOT NULL,
	`specialty` text NOT NULL,
	`description` text NOT NULL,
	`when_to_use` text NOT NULL,
	`source` text DEFAULT 'agency-agents' NOT NULL,
	`color` text DEFAULT '#4f98a3' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
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
	`tasks_completed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
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
	`created_at` text DEFAULT '2026-04-13T13:34:34.758Z' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`parent_goal_id` integer,
	`progress` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
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
	`created_at` text DEFAULT '2026-04-13T13:34:34.758Z' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
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
	`created_at` text DEFAULT '2026-04-13T13:34:34.757Z' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`agent_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT '#4f98a3' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`monthly_budget` real DEFAULT 500 NOT NULL,
	`spent_this_month` real DEFAULT 0 NOT NULL,
	`logo_url` text,
	`mission` text,
	`status` text DEFAULT 'active' NOT NULL,
	`max_agents` integer DEFAULT 25 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);