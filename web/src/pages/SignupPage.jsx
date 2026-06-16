import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { Navbar } from '../components/Navbar.jsx';
import { useAuth } from '../hooks/useAuth.js';

export function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      const message = 'Passwords do not match';
      setError(message);
      toast.error(message);
      return;
    }

    const result = await auth.signup({ email, password });
    if (result.ok) {
      toast.success('Account created successfully');
      navigate('/app');
    } else {
      const message = result.error?.message ?? result.error?.statusText ?? 'Signup failed';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <Navbar />
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 lg:px-10">
        <div className="w-full rounded-[2rem] border border-white/10 bg-atlas-panel p-8 shadow-glow backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-atlas-teal/90">Get started</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Create your account</h1>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/40 focus:bg-slate-900"
              />
            </label>
            {error && <p className="text-sm text-rose-200">{error}</p>}
            <button
              type="submit"
              disabled={auth.isLoading}
              className="w-full rounded-full bg-atlas-teal px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {auth.isLoading ? 'Creating account...' : 'Sign up'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-atlas-sky hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
