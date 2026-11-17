import { cn } from '@/lib/cn';

/** Inline loading indicator. Pass `label` when nothing else announces the loading state. */
export function Spinner({ size = 20, className, label }: { size?: number; className?: string; label?: string }) {
    return (
        <span role={label ? 'status' : undefined} className={cn('inline-flex shrink-0', className)}>
            <svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                className="animate-spin"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {label && <span className="sr-only">{label}</span>}
        </span>
    );
}

/** Placeholder block for content that is loading. */
export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-surface-muted', className)} />;
}

/** Full-height centred loader for whole-page states. */
export function PageLoader({ label }: { label: string }) {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-canvas text-accent">
            <Spinner size={28} label={label} />
        </div>
    );
}
