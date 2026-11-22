'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';
import { STOCK_LEVELS, type ItemLevel, type StockLevel } from '@/lib/grocery/logic';

const FILL: Record<StockLevel, number> = { full: 1, half: 0.5, quarter: 0.25, empty: 0 };

/** Selected-state colours: the jar and the label carry the meaning, colour only reinforces it. */
const TONE: Record<StockLevel, string> = {
    full: 'border-success bg-success-soft text-success',
    half: 'border-warning bg-warning-soft text-warning',
    quarter: 'border-warning bg-warning-soft text-warning',
    empty: 'border-danger bg-danger-soft text-danger',
};

/** A small jar drawn to the level: full, half, quarter or empty. */
export function JarIcon({ level, size = 22 }: { level: ItemLevel; size?: number }) {
    const fill = level === 'unknown' ? 0 : FILL[level];
    const inner = 15; // jar body height in viewBox units
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
            <rect x="8" y="2.5" width="8" height="3" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            {fill > 0 && <rect x="6.2" y={6.2 + inner * (1 - fill)} width="11.6" height={inner * fill} rx="1.5" fill="currentColor" opacity="0.85" />}
            <rect x="5.5" y="5.5" width="13" height="16.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            {level === 'unknown' && <text x="12" y="17.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">?</text>}
        </svg>
    );
}

/**
 * Four large buttons, Full · Half · Quarter · Empty, as a radio group:
 * one tap records the level; arrow keys move between options.
 */
export default function LevelPicker({
    value,
    onChange,
    label,
    disabled = false,
    compact = false,
}: {
    value: ItemLevel | null;
    onChange: (level: StockLevel) => void;
    /** Accessible name, e.g. the item's name. */
    label: string;
    disabled?: boolean;
    compact?: boolean;
}) {
    const { t } = useLocale();
    const buttons = useRef<(HTMLButtonElement | null)[]>([]);
    const selected = value && value !== 'unknown' ? STOCK_LEVELS.indexOf(value) : -1;

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
        const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(3, i + 1)
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1)
                : -1;
        if (next >= 0) {
            e.preventDefault();
            buttons.current[next]?.focus();
        }
    };

    return (
        <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-1.5">
            {STOCK_LEVELS.map((level, i) => {
                const active = i === selected;
                return (
                    <button
                        key={level}
                        ref={el => {
                            buttons.current[i] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={i === (selected >= 0 ? selected : 0) ? 0 : -1}
                        disabled={disabled}
                        onClick={() => onChange(level)}
                        onKeyDown={e => onKeyDown(e, i)}
                        className={cn(
                            'flex flex-col items-center justify-center gap-0.5 rounded-xl border font-semibold transition-colors active:scale-[0.97] disabled:opacity-50',
                            compact ? 'h-12 text-[11px]' : 'h-16 text-xs',
                            active ? TONE[level] : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                        )}
                    >
                        <JarIcon level={level} size={compact ? 18 : 22} />
                        {t(`grocery.level.${level}`)}
                    </button>
                );
            })}
        </div>
    );
}
