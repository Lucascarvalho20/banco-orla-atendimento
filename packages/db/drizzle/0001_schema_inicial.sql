CREATE TYPE "public"."agent_presence" AS ENUM('online', 'offline', 'away');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('agent', 'supervisor');--> statement-breakpoint
CREATE TYPE "public"."assignment_action" AS ENUM('offered', 'accepted', 'declined', 'timeout', 'transferred', 'requeued');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('ai', 'queued', 'offered', 'active', 'closed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('customer', 'ai', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('rascunho', 'publicado');--> statement-breakpoint
CREATE TYPE "public"."resolved_by" AS ENUM('ai', 'agent');--> statement-breakpoint
CREATE TABLE "agent_status" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"status" "agent_presence" DEFAULT 'offline' NOT NULL,
	"last_assigned_at" timestamp with time zone,
	"active_count" integer DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_status_active_count_non_negative" CHECK ("agent_status"."active_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "agent_role" DEFAULT 'agent' NOT NULL,
	"max_concurrent" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_email_unique" UNIQUE("email"),
	CONSTRAINT "agents_max_concurrent_positive" CHECK ("agents"."max_concurrent" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_traces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"latency_ms" integer,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" uuid,
	"action" "assignment_action" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer,
	"shortcut" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "canned_responses_shortcut_unique" UNIQUE("shortcut")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"topic_id" integer NOT NULL,
	"status" "conversation_status" DEFAULT 'ai' NOT NULL,
	"ai_summary" text,
	"resolved_by" "resolved_by",
	"priority" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone,
	"offered_to" uuid,
	"offered_at" timestamp with time zone,
	"agent_id" uuid,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"rating" smallint,
	"decline_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_rating_range" CHECK ("conversations"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"cpf_hash" char(64) NOT NULL,
	"cpf_last2" char(2) NOT NULL,
	"ai_questions_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" "publication_status" DEFAULT 'rascunho' NOT NULL,
	"embedding" vector(768),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', question)) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"section" text NOT NULL,
	"content" text NOT NULL,
	"tokens" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', section || ' ' || content)) STORED,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_path" text NOT NULL,
	"topic_id" integer,
	"status" "publication_status" DEFAULT 'rascunho' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_hash" char(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_documents_source_path_unique" UNIQUE("source_path")
);
--> statement-breakpoint
CREATE TABLE "kb_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_normalized" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_gaps_question_normalized_unique" UNIQUE("question_normalized")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"client_msg_id" uuid,
	"sender" "message_sender" NOT NULL,
	"body" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "agent_status" ADD CONSTRAINT "agent_status_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_traces" ADD CONSTRAINT "ai_traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_log" ADD CONSTRAINT "assignment_log_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_log" ADD CONSTRAINT "assignment_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_session_id_customer_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."customer_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_offered_to_agents_id_fk" FOREIGN KEY ("offered_to") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq" ADD CONSTRAINT "faq_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_status_available_idx" ON "agent_status" USING btree ("status","last_assigned_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ai_traces_conversation_idx" ON "ai_traces" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "assignment_log_conversation_idx" ON "assignment_log" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_queue_idx" ON "conversations" USING btree ("topic_id","priority" DESC NULLS FIRST,"queued_at") WHERE "conversations"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_cpf_hash_idx" ON "customer_sessions" USING btree ("cpf_hash");--> statement-breakpoint
CREATE INDEX "faq_tsv_idx" ON "faq" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "faq_embedding_idx" ON "faq" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunks_document_idx" ON "kb_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_tsv_idx" ON "kb_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_uq" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_client_msg_uq" ON "messages" USING btree ("conversation_id","client_msg_id");