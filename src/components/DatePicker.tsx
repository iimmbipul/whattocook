"use client";

import React, { useEffect, useRef } from 'react';
import { format, addDays, isSameDay } from 'date-fns';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';

interface DatePickerProps {
    selectedDate: Date;
    onDateSelect: (date: Date) => void;
}

/** Horizontal strip of the next 14 days. */
const DatePicker = ({ selectedDate, onDateSelect }: DatePickerProps) => {
    const { t } = useLocale();
    const today = new Date();
    const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    const selectedRef = useRef<HTMLButtonElement>(null);

    // Keep the selected day visible when it changes (e.g. late in the strip).
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [selectedDate]);

    return (
        <div role="group" aria-label={t('dashboard.dayPicker')} className="-mx-4 sm:mx-0">
            <div className="flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 scrollbar-hide sm:scroll-px-0.5 sm:px-0.5">
                {dates.map((date, index) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const isToday = index === 0;
                    return (
                        <button
                            key={date.toDateString()}
                            ref={isSelected ? selectedRef : undefined}
                            type="button"
                            onClick={() => onDateSelect(date)}
                            aria-pressed={isSelected}
                            aria-label={`${isToday ? `${t('nav.today')}, ` : ''}${format(date, 'EEEE, MMMM d')}`}
                            className={cn(
                                'flex h-[68px] w-[52px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border transition-colors duration-150',
                                isSelected
                                    ? 'border-accent bg-accent text-white shadow-raised'
                                    : 'border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted',
                            )}
                        >
                            <span className={cn('text-[11px] font-semibold uppercase tracking-wide', isSelected ? 'text-white/85' : 'text-ink-muted')}>
                                {format(date, 'EEE')}
                            </span>
                            <span className="text-lg font-bold leading-none">{format(date, 'd')}</span>
                            <span
                                className={cn('h-1 w-1 rounded-full', isToday ? (isSelected ? 'bg-white' : 'bg-accent') : 'bg-transparent')}
                                aria-hidden="true"
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default DatePicker;
