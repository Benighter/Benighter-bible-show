import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://hkyuaxvygmijzrpxfcit.supabase.co';
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_1DmLxAps9czI50lVDHabDw_RARFfMiX';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
});

let cachedSupabaseAccessToken: string | null = null;

void supabase.auth.getSession().then(({ data }) => {
    cachedSupabaseAccessToken = data.session?.access_token ?? null;
}).catch(() => {
    cachedSupabaseAccessToken = null;
});

supabase.auth.onAuthStateChange((_event, session) => {
    cachedSupabaseAccessToken = session?.access_token ?? null;
});

export function getSupabaseAccessToken() {
    return cachedSupabaseAccessToken;
}
