// Re-export from browserClient so that any auto-generated or accidental
// imports of "@/integrations/supabase/client" resolve to the robust
// browser client (which includes baked config fallback for Lovable).
export { supabase } from "./browserClient";
export type { Database } from "./types";
