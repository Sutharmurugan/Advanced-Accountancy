-- ============================================================================
-- Fix: the posted-journal-entry immutability trigger blocked the one
-- transition that is supposed to be legal on a posted entry — flipping its
-- own status to 'reversed' when AccountingEngineService.reverse() runs
-- (section D: correction is a reversal, which requires marking the original
-- entry reversed). The trigger was rejecting that update outright. Now it
-- allows exactly that one transition (posted -> reversed) and continues to
-- reject every other mutation of a posted row.
-- ============================================================================

create or replace function reject_edit_of_posted_journal_entry()
returns trigger as $$
begin
  if old.status = 'posted' and new.status = 'reversed' then
    return new;
  end if;
  if old.status = 'posted' then
    raise exception 'journal_entries.%: cannot modify a posted entry; use a reversal or adjustment entry', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
