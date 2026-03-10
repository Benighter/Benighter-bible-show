import { createContext, useContext } from 'react';

export type AppUser = {
    uid: string;
    email: string | null;
    displayName: string | null;
};

export type AuthContextValue = {
    user: AppUser | null;
    authReady: boolean;
    isAuthenticating: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOutUser: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    updateDisplayName: (displayName: string) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used inside AuthProvider.');
    }

    return context;
}
