-- A creator is captured at self-registration. Existing tenants remain NULL:
-- current ownership does not prove who originally registered a workspace.
ALTER TABLE public.tenants ADD COLUMN created_by_user_id UUID;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES public.users(id)
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX tenants_created_by_user_id_idx ON public.tenants(created_by_user_id);
