import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest} />;
}

/** A titled card section, used for settings-style pages. */
export function Section({
    title,
    description,
    icon,
    action,
    children,
    className,
    tone = 'default',
}: {
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
    className?: string;
    tone?: 'default' | 'danger';
}) {
    return (
        <Card className={cn('p-5 sm:p-6', tone === 'danger' && 'border-danger/25', className)}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    {icon && (
                        <span
                            className={cn(
                                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                                tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-strong',
                            )}
                            aria-hidden="true"
                        >
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-ink">{title}</h2>
                        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
                    </div>
                </div>
                {action}
            </div>
            {children}
        </Card>
    );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center px-6 py-10 text-center">
            {icon && (
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-ink-muted" aria-hidden="true">
                    {icon}
                </span>
            )}
            <p className="text-[15px] font-semibold text-ink">{title}</p>
            {body && <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}
