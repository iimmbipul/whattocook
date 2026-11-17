'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
}

/** A row of mutually exclusive toggle buttons (filters, view switches). */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
    label,
    size = 'md',
    className,
}: {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Accessible name for the group. */
    label: string;
    size?: 'sm' | 'md';
    className?: string;
}) {
    return (
        <div role="group" aria-label={label} className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1 scrollbar-hide', className)}>
            {options.map(opt => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'shrink-0 rounded-lg px-3.5 font-semibold transition-colors duration-150',
                            size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm',
                            active ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
