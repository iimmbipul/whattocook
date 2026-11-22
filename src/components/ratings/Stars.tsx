'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatAverage } from '@/lib/ratings/client';

/**
 * 1–5 star picker. A radio group: Tab reaches it once, arrow keys move the
 * choice, and each star announces "n out of 5 stars".
 */
export function StarInput({
    value,
    onChange,
    label,
    starLabel,
    disabled = false,
}: {
    value: number;
    onChange: (value: number) => void;
    /** Accessible name of the group, e.g. "Food". */
    label: string;
    starLabel: (n: number) => string;
    disabled?: boolean;
}) {
    const buttons = useRef<(HTMLButtonElement | null)[]>([]);

    const choose = (n: number) => {
        onChange(n);
        buttons.current[n - 1]?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
        const next =
            e.key === 'ArrowRight' || e.key === 'ArrowUp' ? Math.min(5, n + 1)
                : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? Math.max(1, n - 1)
                    : e.key === 'Home' ? 1
                        : e.key === 'End' ? 5
                            : 0;
        if (next) {
            e.preventDefault();
            choose(next);
        }
    };

    return (
        <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center">
            {[1, 2, 3, 4, 5].map(n => (
                <button
                    key={n}
                    ref={el => {
                        buttons.current[n - 1] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={value === n}
                    aria-label={starLabel(n)}
                    tabIndex={n === (value || 1) ? 0 : -1}
                    disabled={disabled}
                    onClick={() => choose(n)}
                    onKeyDown={e => onKeyDown(e, n)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg transition-transform duration-100 active:scale-90 disabled:opacity-50"
                >
                    <Star
                        size={28}
                        strokeWidth={1.6}
                        aria-hidden="true"
                        className={cn('transition-colors', n <= value ? 'fill-star text-star' : 'fill-transparent text-ink-subtle')}
                    />
                </button>
            ))}
        </div>
    );
}

/** A compact average such as "★ 4.3", read as "4.3 out of 5". */
export function StarScore({ value, label, className }: { value: number | null; label?: string; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 tabular-nums', className)}>
            <Star size={14} aria-hidden="true" className={value === null ? 'fill-transparent text-ink-subtle' : 'fill-star text-star'} />
            <span aria-hidden="true">{formatAverage(value)}</span>
            <span className="sr-only">{label ?? (value === null ? '–' : `${formatAverage(value)} / 5`)}</span>
        </span>
    );
}
