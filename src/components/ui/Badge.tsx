import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<BadgeTone, string> = {
    neutral: 'bg-surface-muted text-ink-muted',
    accent: 'bg-accent-soft text-accent-strong',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
    return (
        <span
            className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold', tones[tone], className)}
            {...rest}
        />
    );
}

/** Round initials avatar (or photo). */
export function Avatar({ name, photoURL, size = 36, className }: { name: string; photoURL?: string | null; size?: number; className?: string }) {
    const initial = (name.trim().charAt(0) || '?').toUpperCase();
    return (
        <span
            className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent-strong', className)}
            style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
            aria-hidden="true"
        >
            {photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
                initial
            )}
        </span>
    );
}
