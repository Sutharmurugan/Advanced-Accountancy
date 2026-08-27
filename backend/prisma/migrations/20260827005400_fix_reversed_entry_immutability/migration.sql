-- ============================================================================
-- Fix: once an entry transitions to 'reversed' it was no longer protected by
-- the immutability trigger at all (the check only looked at old.status =
-- 'posted'). A reversed entry is still a historical ledger record and must
-- stay immutable too — only the one posted -> reversed transition itself is
-- a legal mutation; nothing may change a row that is already posted or
-- already reversed.
-- ============================================================================

create or replace function reject_edit_of_posted_journal_entry()
returns trigger as $$
begin
  if old.status = 'posted' and new.status = 'reversed' then
    return new;
  end if;
  if old.status in ('posted', 'reversed') then
    raise exception 'journal_entries.%: cannot modify a % entry; use a reversal or adjustment entry', old.id, old.status;
  end if;
  return new;
end;
$$ language plpgsql;
