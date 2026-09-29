import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { initials } from '../../lib/format';
import type { UserRole } from '../../types/database';

const nav: { to: string; label: string; adminOnly?: boolean; end?: boolean }[] = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/leads', label: 'Leads' },
    { to: '/app/recovery', label: 'Recovery' },
  { to: '/app/customers', label: 'Customers' },
  { to: '/app/activities', label: 'Activities' },
  { to: '/app/tasks', label: 'Tasks' },
  { to: '/app/calendar', label: 'Calendar' },
  { to: '/app/automations', label: 'Automations' },
  { to: '/app/ai-assistant', label: 'AI Assistant' },
  { to: '/app/analytics', label: 'Analytics' },
  { to: '/app/integrations', label: 'Integrations' },
  { to: '/app/settings', label: 'Settings', adminOnly: true },
  { to: '/app/billing', label: 'Billing', adminOnly: true },
];

function roleLabel(role: UserRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function AppLayout() {
  const { profile, activeBusiness, businesses, setActiveBusinessId, signOut, activeRole } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">R</span>
          <span className="font-bold tracking-tight text-slate-900">Revora</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          {activeBusiness && (
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-500">Business</label>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={activeBusiness.id}
                onChange={(e) => setActiveBusinessId(e.target.value)}
                aria-label="Switch business"
              >
                {businesses.map(({ business }) => (
                  <option key={business.id} value={business.id}>{business.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{profile?.full_name ?? 'Account'}</p>
              <p className="text-xs text-slate-500">{activeRole ? roleLabel(activeRole) : ''}</p>
            </div>
            <button
              onClick={async () => { await signOut(); navigate('/'); }}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Log out"
              title="Log out"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar with nav */}
      <div className="flex min-h-screen w-full flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8">
          <span className="flex items-center gap-2 lg:hidden">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">R</span>
            <span className="font-bold text-slate-900">Revora</span>
          </span>
          <div className="hidden text-sm font-medium text-slate-500 lg:block">
            {activeBusiness?.name ?? ''}
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {profile?.full_name ? initials(profile.full_name) : 'A'}
          </div>
        </header>
        <div className="overflow-x-auto border-b border-slate-200 bg-white px-4 lg:hidden">
          <nav className="flex gap-1 py-2">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600'}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <main className="flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
