import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthError, User } from '@supabase/supabase-js';
import { AuthContext, type AppUser, type AuthContextValue } from './auth-context';
import { supabase } from './supabase';

function formatAuthError(error: unknown) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : 0;

    switch (code) {
        case 'email_exists':
            return 'That email address already has an account.';
        case 'invalid_credentials':
            return 'Incorrect email or password.';
        case 'email_address_invalid':
            return 'Enter a valid email address.';
        case 'weak_password':
            return 'Use a stronger password with at least 6 characters.';
        case 'over_email_send_rate_limit':
            return 'Too many email requests. Try again later.';
        case 'unexpected_failure':
            return 'Authentication failed. Try again.';
        default:
            if (status === 400 && error instanceof Error && error.message.toLowerCase().includes('invalid login credentials')) {
                return 'Incorrect email or password.';
            }

            if (status === 422) {
                return 'Enter a valid email address.';
            }

            if (error instanceof Error && error.message.toLowerCase().includes('network')) {
                return 'Network error. Check your connection and try again.';
            }

            return error instanceof Error ? error.message : 'Authentication failed.';
    }
}

function mapSupabaseUser(user: User | null): AppUser | null {
    if (!user) {
        return null;
    }

    const metadata = user.user_metadata as Record<string, unknown> | undefined;

    return {
        uid: user.id,
        email: user.email ?? null,
        displayName: typeof metadata?.display_name === 'string'
            ? metadata.display_name
            : typeof metadata?.full_name === 'string'
                ? metadata.full_name
                : null,
    };
}

function expectAuthSuccess(error: AuthError | null) {
    if (error) {
        throw new Error(formatAuthError(error));
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AppUser | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const initialize = async () => {
            const { data, error } = await supabase.auth.getSession();

            if (!isMounted) {
                return;
            }

            if (error) {
                console.warn('Unable to restore Supabase auth session.', error);
            }

            setUser(mapSupabaseUser(data.session?.user ?? null));
            setAuthReady(true);
        };

        void initialize();

        const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(mapSupabaseUser(session?.user ?? null));
            setAuthReady(true);
        });

        return () => {
            isMounted = false;
            authSubscription.subscription.unsubscribe();
        };
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        user,
        authReady,
        isAuthenticating,
        signIn: async (email, password) => {
            setIsAuthenticating(true);
            try {
                const { error } = await supabase.auth.signInWithPassword({
                    email: email.trim(),
                    password,
                });

                expectAuthSuccess(error);
            } finally {
                setIsAuthenticating(false);
            }
        },
        signUp: async (email, password) => {
            setIsAuthenticating(true);
            try {
                const { error } = await supabase.auth.signUp({
                    email: email.trim(),
                    password,
                });

                expectAuthSuccess(error);
            } finally {
                setIsAuthenticating(false);
            }
        },
        signOutUser: async () => {
            setIsAuthenticating(true);
            try {
                const { error } = await supabase.auth.signOut();
                expectAuthSuccess(error);
            } finally {
                setIsAuthenticating(false);
            }
        },
        resetPassword: async (email) => {
            setIsAuthenticating(true);
            try {
                const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
                expectAuthSuccess(error);
            } finally {
                setIsAuthenticating(false);
            }
        },
        updateDisplayName: async (displayName) => {
            setIsAuthenticating(true);
            try {
                const { data, error } = await supabase.auth.updateUser({
                    data: {
                        display_name: displayName.trim(),
                    },
                });

                expectAuthSuccess(error);
                setUser(mapSupabaseUser(data.user ?? null));
            } finally {
                setIsAuthenticating(false);
            }
        },
    }), [authReady, isAuthenticating, user]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
