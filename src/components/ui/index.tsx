import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------- Form controls ----------
const inputBase =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputBase} ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${inputBase} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputBase} min-h-[100px] ${className}`} {...props} />;
}

// ---------- Card ----------
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {action}
    </div>
  );
}

// ---------- Badge ----------
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

// ---------- States ----------
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <svg className="h-5 w-5 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label ?? 'Loading…'}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        )}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">!</div>
      <h3 className="text-sm font-semibold text-slate-900">Something went wrong</h3>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ---------- Stat card ----------
export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <Card className={`p-5 ${accent ? 'border-brand-200 bg-brand-50/50' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

// ---------- Coming soon ----------
export function ComingSoon({ title, description, planned }: { title: string; description: string; planned?: string[] }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
        Coming soon
      </span>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {planned && planned.length > 0 && (
        <div className="mt-6 w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Planned capabilities</p>
          <ul className="space-y-2">
            {planned.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
