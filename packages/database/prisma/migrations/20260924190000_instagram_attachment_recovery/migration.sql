CREATE UNIQUE INDEX "attachments_message_id_type_original_url_key"
ON "attachments"("message_id", "type", "original_url");
