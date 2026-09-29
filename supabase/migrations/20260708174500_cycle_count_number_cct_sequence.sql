with numbered_counts as (
  select
    id,
    row_number() over (order by created_at, id) as sequence_number,
    to_char(timezone('America/Barbados', coalesce(created_at, now())), 'DDMMYYYYHH24MISS') as timestamp_code
  from public.cycle_counts
  where count_number not like 'CCT-%'
)
update public.cycle_counts cycle_count
set count_number = 'CCT-' || numbered_counts.sequence_number::text || numbered_counts.timestamp_code,
    updated_at = timezone('utc', now())
from numbered_counts
where cycle_count.id = numbered_counts.id;
