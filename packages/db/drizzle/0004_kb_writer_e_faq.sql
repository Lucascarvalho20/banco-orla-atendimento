CREATE UNIQUE INDEX "faq_question_uq" ON "faq" USING btree ("question");
--> statement-breakpoint

-- Usuário de banco da ingestão (Lambda e script da FAQ): escreve SÓ na base de conhecimento.
-- Não lê sessões, conversas nem mensagens. A senha vem de KB_WRITER_PASSWORD (script de migração).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kb_writer') THEN
    CREATE ROLE kb_writer NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE kb_writer SET statement_timeout = '30s';
--> statement-breakpoint
ALTER ROLE kb_writer CONNECTION LIMIT 5;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kb_writer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kb_writer;
--> statement-breakpoint
GRANT SELECT ON topics TO kb_writer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_documents, kb_chunks, faq TO kb_writer;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE kb_documents_id_seq, kb_chunks_id_seq, faq_id_seq TO kb_writer;
--> statement-breakpoint

-- As tabelas da base têm RLS (migration 0002). Sem política, o kb_writer não veria nem gravaria
-- nenhuma linha; ele precisa de todas, inclusive rascunhos.
CREATE POLICY kb_writer_documentos ON kb_documents FOR ALL TO kb_writer USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY kb_writer_trechos ON kb_chunks FOR ALL TO kb_writer USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY kb_writer_faq ON faq FOR ALL TO kb_writer USING (true) WITH CHECK (true);
