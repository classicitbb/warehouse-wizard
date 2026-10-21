export const isSupabaseConfigured = false;
export const supabase = {
  from: () => { throw new Error("Unexpected backend read in local browser fixture"); },
  rpc: () => { throw new Error("Unexpected backend call in local browser fixture"); },
};
