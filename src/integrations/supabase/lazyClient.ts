export async function getSupabaseClientLazy() {
  const module = await import("./browserClient");
  return module.supabase;
}
