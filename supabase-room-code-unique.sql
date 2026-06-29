alter table public.rooms
  add constraint rooms_invite_code_unique unique (invite_code);
