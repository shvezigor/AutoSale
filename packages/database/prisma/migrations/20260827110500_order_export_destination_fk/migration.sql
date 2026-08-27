ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "google_sheets_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
