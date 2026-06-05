import { Link } from 'react-router-dom';

import { Navbar } from '../components/Navbar.jsx';

export function LandingPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(72,215,200,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(124,199,255,0.14),_transparent_28%),linear-gradient(180deg,_#06111f_0%,_#091523_50%,_#050b13_100%)] text-slate-100">
      <Navbar />
      <div className="mx-auto flex max-w-7xl flex-col items-center px-6 py-32 lg:px-10">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-atlas-sky/80">Atlas</p>
          <h1 className="mt-6 text-5xl font-bold tracking-tight text-white md:text-6xl lg:text-7xl">
            Your personal<br />knowledge platform
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Upload documents, search semantically, and chat with your knowledge base.
            Atlas ingests your content and makes it instantly searchable with citation-aware AI.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              to="/login"
              className="rounded-full bg-atlas-teal px-8 py-4 text-base font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="rounded-full border border-white/10 bg-white/5 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
