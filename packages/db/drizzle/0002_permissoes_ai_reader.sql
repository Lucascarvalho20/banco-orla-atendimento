-- Usuário de banco da IA: só lê a base pública, e só o que está publicado (ADR 0008, OWASP LLM02/LLM08).
-- A senha NÃO fica aqui: o script de migração faz `ALTER ROLE ... LOGIN PASSWORD` com AI_READER_PASSWORD.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_reader') THEN
    CREATE ROLE ai_reader NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE ai_reader SET default_transaction_read_only = on;
--> statement-breakpoint
ALTER ROLE ai_reader SET statement_timeout = '5s';
--> statement-breakpoint
ALTER ROLE ai_reader CONNECTION LIMIT 10;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ai_reader;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ai_reader;
--> statement-breakpoint
GRANT SELECT ON kb_documents, kb_chunks, faq TO ai_reader;
--> statement-breakpoint

-- Row Level Security: mesmo nas tabelas liberadas, a IA só enxerga linhas publicadas.
-- O dono das tabelas (usado pelo servidor) não é afetado.
ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_reader_documentos_publicados ON kb_documents
  FOR SELECT TO ai_reader
  USING (status = 'publicado');
--> statement-breakpoint
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_reader_trechos_publicados ON kb_chunks
  FOR SELECT TO ai_reader
  USING (EXISTS (
    SELECT 1 FROM kb_documents d WHERE d.id = kb_chunks.document_id AND d.status = 'publicado'
  ));
--> statement-breakpoint
ALTER TABLE faq ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_reader_faq_publicada ON faq
  FOR SELECT TO ai_reader
  USING (status = 'publicado');
