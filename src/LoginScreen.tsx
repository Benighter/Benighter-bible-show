import { useState, type FormEvent } from 'react';
import { LogIn, MonitorPlay, UserPlus } from 'lucide-react';
import { useAuth } from './lib/auth-context';

export default function LoginScreen() {
    const { signIn, signUp, resetPassword, isAuthenticating } = useAuth();
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setErrorMessage(null);
        setSuccessMessage(null);

        if (mode === 'signup' && password !== confirmPassword) {
            setErrorMessage('Passwords do not match.');
            return;
        }

        try {
            if (mode === 'signin') {
                await signIn(email, password);
            } else {
                await signUp(email, password);
                setSuccessMessage('Account created. Check your email for any next steps, then sign in.');
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Unable to complete authentication.');
        }
    };

    const handlePasswordReset = async () => {
        setErrorMessage(null);
        setSuccessMessage(null);

        if (!email.trim()) {
            setErrorMessage('Enter your email address first, then request a password reset link.');
            return;
        }

        try {
            await resetPassword(email);
            setSuccessMessage(`Password reset email sent to ${email.trim()}.`);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Unable to send the password reset email.');
        }
    };

    return (
        <div className="auth-shell">
            <div className="auth-panel">
                <div className="auth-brand">
                    <span className="auth-brand-badge">
                        <MonitorPlay size={18} />
                    </span>
                    <div>
                        <h1>Bible Show</h1>
                        <p>Sign in to keep your Bibles, songs, media, presentations, themes, and settings saved to your account.</p>
                    </div>
                </div>

                <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
                    <button
                        className={mode === 'signin' ? 'active' : ''}
                        onClick={() => setMode('signin')}
                        type="button"
                    >
                        Sign In
                    </button>
                    <button
                        className={mode === 'signup' ? 'active' : ''}
                        onClick={() => setMode('signup')}
                        type="button"
                    >
                        Create Account
                    </button>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                    <label>
                        <span>Email</span>
                        <input
                            autoComplete="email"
                            onChange={(event) => setEmail(event.target.value)}
                            required
                            type="email"
                            value={email}
                        />
                    </label>
                    <label>
                        <span>Password</span>
                        <input
                            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                            minLength={6}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                            type="password"
                            value={password}
                        />
                    </label>
                    {mode === 'signup' && (
                        <label>
                            <span>Confirm Password</span>
                            <input
                                autoComplete="new-password"
                                minLength={6}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                required
                                type="password"
                                value={confirmPassword}
                            />
                        </label>
                    )}

                    {errorMessage && <div className="auth-error">{errorMessage}</div>}
                    {successMessage && <div className="auth-success">{successMessage}</div>}

                    <button className="auth-submit" disabled={isAuthenticating} type="submit">
                        {mode === 'signin' ? <LogIn size={18} /> : <UserPlus size={18} />}
                        <span>{isAuthenticating ? 'Working...' : mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                    </button>

                    {mode === 'signin' && (
                        <button className="auth-secondary-btn" disabled={isAuthenticating} onClick={handlePasswordReset} type="button">
                            Send Password Reset Email
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
