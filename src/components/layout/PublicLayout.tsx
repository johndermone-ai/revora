import { Link, Outlet } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">R</span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Revora</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <Link className="hover:text-slate-900" to="/pricing">Pricing</Link>
            <Link className="hover:text-slate-900" to="/login">Log in</Link>
            <Link to="/signup" className="rounded-lg bg-brand-600 px-4 py-2 text-white transition-colors hover:bg-brand-700">
              Get started
            </Link>
          </nav>
        </div>
      </header>
      <Outlet />
      <footer className="border-t border-slate-100 py-10">
        <div className="mx-auto max-w-6xl px-4 text-sm text-slate-500 sm:px-6">
          <p>© {new Date().getFullYear()} Revora. Capture. Qualify. Convert. Retain.</p>
        </div>
      </footer>
    </div>
  );
}
