import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../hooks/useAuth.js';

const FEATURES = [
  { icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', label: 'Semantic Search', desc: 'Find anything across your documents' },
  { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', label: 'AI Citations', desc: 'Answers grounded in your sources' },
  { icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', label: 'Private Knowledge Base', desc: 'Your data stays yours, always encrypted' },
];

function ParticleCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let anim;
    const particles = Array.from({ length: 30 }, () => ({
      x: Math.random() * 500,
      y: Math.random() * 500,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
    }));

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(72, 215, 200, 0.25)';
        ctx.fill();
      }
      anim = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(anim);
  }, []);

  return <canvas ref={canvasRef} width={500} height={500} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [featuresVisible, setFeaturesVisible] = useState(false);
  const emailRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setFeaturesVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const result = await auth.login({ email, password });
    if (result.ok) {
      toast.success('Logged in successfully');
      navigate('/app');
    } else {
      const message = result.error?.message ?? result.error?.statusText ?? 'Login failed';
      setError(message);
      toast.error(message);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      emailRef.current?.blur();
    }
  }

  const handleEmailChange = useCallback((e) => setEmail(e.target.value), []);
  const handlePasswordChange = useCallback((e) => setPassword(e.target.value), []);

  return (
    <main className="flex min-h-dvh flex-col bg-[#050b13] text-slate-100 lg:flex-row">
      <div className="relative flex min-h-[40vh] flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,_rgba(72,215,200,0.18),_transparent_50%),radial-gradient(circle_at_bottom_left,_rgba(124,199,255,0.12),_transparent_40%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] px-6 lg:min-h-0 lg:w-1/2 lg:px-12">
        <ParticleCanvas />
        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-atlas-teal/[0.04] blur-3xl lg:h-[600px] lg:w-[600px]" style={{ animationDuration: '4s' }} />
        </div>
        <div className="relative z-10 w-full max-w-md text-center lg:text-left">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-atlas-teal/20 bg-atlas-teal/10 shadow-[0_0_24px_rgba(72,215,200,0.1)] lg:mx-0">
            <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                <linearGradient id="login-logo" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#48d7c8" />
                  <stop offset="100%" stopColor="#7cc7ff" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="48" fill="none" stroke="url(#login-logo)" strokeWidth="6" />
              <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#login-logo)" textAnchor="middle">A</text>
            </svg>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">Atlas</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400 lg:text-base">
            Your AI Knowledge Workspace
          </p>

          <div className="mt-10 space-y-4">
            {FEATURES.map((f, i) => (
              <div
                key={f.label}
                className={`flex items-start gap-4 transition-all duration-500 ${
                  featuresVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
                }`}
                style={{ transitionDelay: `${i * 150 + 200}ms` }}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-atlas-teal/15 bg-atlas-teal/10">
                  <svg className="h-4 w-4 text-atlas-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={f.icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{f.label}</p>
                  <p className="text-xs text-slate-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold tracking-[0.18em] text-white/90">
              <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <linearGradient id="login-logo-m" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#48d7c8" />
                    <stop offset="100%" stopColor="#7cc7ff" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="48" fill="none" stroke="url(#login-logo-m)" strokeWidth="6" />
                <text x="50" y="68" fontFamily="system-ui" fontWeight="800" fontSize="48" fill="url(#login-logo-m)" textAnchor="middle">A</text>
              </svg>
              ATLAS
            </Link>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-atlas-teal/70">Welcome back</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Log in to Atlas</h1>

            <form ref={formRef} onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="mt-8 space-y-5">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-300">Email</label>
                <input
                  ref={emailRef}
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/50 focus:bg-slate-900 focus:shadow-[0_0_12px_rgba(72,215,200,0.06)]"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-300">Password</label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={handlePasswordChange}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-atlas-teal/50 focus:bg-slate-900 focus:shadow-[0_0_12px_rgba(72,215,200,0.06)]"
                />
              </div>
              {error && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3" role="alert">
                  <p className="text-sm text-rose-200">{error}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={auth.isLoading}
                className="w-full rounded-xl bg-atlas-teal px-5 py-2.5 text-sm font-semibold text-slate-950 transition-all hover:bg-atlas-teal/90 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atlas-teal/50 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {auth.isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Logging in...
                  </span>
                ) : 'Log in'}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-slate-400">
              Don&apos;t have an account?{' '}
              <Link to="/signup" className="font-semibold text-atlas-sky underline underline-offset-2 hover:text-atlas-sky/80 transition-colors">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
