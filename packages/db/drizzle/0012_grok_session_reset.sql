-- Reset Grok chat sessions so research uses Responses+web_search (not legacy Places stubs).
UPDATE "users" SET "grok_response_id" = NULL WHERE "grok_response_id" IS NOT NULL;
