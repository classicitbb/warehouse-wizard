-- Remove seeded task data that cannot be actioned through the normal UI flows.
-- Seeded records are identified by their short zero-padded task numbers
-- (e.g. PTA-00001, MOV-0001, CNT-0001) vs app-generated timestamp numbers
-- (e.g. PTA-17365432), or by their specific seed notes/reason strings.

-- Cycle count lines must be deleted before their parent cycle counts.
delete from public.cycle_count_lines
where cycle_count_id in (
  select id from public.cycle_counts
  where notes = 'Seeded cycle count workload.'
);

-- Remove seeded cycle counts (notes = 'Seeded cycle count workload.')
delete from public.cycle_counts
where notes = 'Seeded cycle count workload.';

-- Remove seeded move tasks (reason = 'Seeded transfer move task.')
delete from public.move_tasks
where reason = 'Seeded transfer move task.';

-- Remove seeded putaway tasks (short zero-padded task numbers, length <= 9)
delete from public.putaway_tasks
where length(task_number) <= 9
  and task_number ~ '^PTA-';
