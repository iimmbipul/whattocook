import type { ReactNode } from 'react';
import { UtensilsCrossed } from 'lucide-react';

/** Centered card layout for signed-out screens (login, onboarding). */
export default function AuthLayout({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
            <main className="w-full max-w-sm">
                <div className="mb-8 flex flex-col items-center text-center">
                    <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-darkest text-brand-light shadow-raised" aria-hidden="true">
                        <UtensilsCrossed size={22} strokeWidth={2.25} />
                    </span>
                    <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
                    {subtitle && <p className="mt-1.5 text-[15px] text-ink-muted">{subtitle}</p>}
                </div>
                <div className="rounded-2xl border border-line bg-surface p-6 shadow-raised">{children}</div>
                {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
            </main>
        </div>
    );
}
