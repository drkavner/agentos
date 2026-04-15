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
	`created_at` text DEFAULT '2026-04-13T13:43:58.270Z' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "tenant_id", "agent_id", "agent_name", "action", "entity", "entity_id", "detail", "tokens_used", "cost", "created_at") SELECT "id", "tenant_id", "agent_id", "agent_name", "action", "entity", "entity_id", "detail", "tokens_used", "cost", "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	`created_at` text DEFAULT '2026-04-13T13:43:58.270Z' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "tenant_id", "channel_id", "channel_type", "sender_agent_id", "sender_name", "sender_emoji", "content", "message_type", "metadata", "created_at") SELECT "id", "tenant_id", "channel_id", "channel_type", "sender_agent_id", "sender_name", "sender_emoji", "content", "message_type", "metadata", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
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
	`created_at` text DEFAULT '2026-04-13T13:43:58.269Z' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "tenant_id", "title", "description", "status", "priority", "assigned_agent_id", "created_by_id", "team_id", "goal_tag", "estimated_tokens", "actual_tokens", "due_date", "completed_at", "created_at") SELECT "id", "tenant_id", "title", "description", "status", "priority", "assigned_agent_id", "created_by_id", "team_id", "goal_tag", "estimated_tokens", "actual_tokens", "due_date", "completed_at", "created_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;