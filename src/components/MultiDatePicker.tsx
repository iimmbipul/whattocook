"use client";

import React from 'react';
import { format, addDays, isSameDay, isToday } from 'date-fns';
import { cn } from '@/lib/cn';

interface MultiDatePickerProps {
    selectedDates: Date[];
    onDateToggle: (date: Date) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month grid for picking several days of the current month. */
const MultiDatePicker = ({ selectedDates, onDateToggle }: MultiDatePickerProps) => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dates = Array.from({ length: daysInMonth }, (_, i) => addDays(startOfMonth, i));
    // Monday-first offset for the first day of the month.
    const leading = (startOfMonth.getDay() + 6) % 7;

    const isDateSelected = (date: Date) => selectedDates.some(d => isSameDay(d, date));

    return (
        <div role="group" aria-label={`Select days in ${format(startOfMonth, 'MMMM yyyy')}`}>
            <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{format(startOfMonth, 'MMMM yyyy')}</p>
                <p className="text-xs text-ink-muted">{selectedDates.length} selected</p>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" aria-hidden="true">
                {WEEKDAYS.map(d => (
                    <span key={d} className="py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{d}</span>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: leading }, (_, i) => <span key={`pad-${i}`} />)}
                {dates.map((date) => {
                    const selected = isDateSelected(date);
                    const current = isToday(date);
                    return (
                        <button
                            key={date.toDateString()}
                            type="button"
                            onClick={() => onDateToggle(date)}
                            aria-pressed={selected}
                            aria-label={format(date, 'EEEE, MMMM d')}
                            className={cn(
                                'relative flex aspect-square items-center justify-center rounded-xl text-sm font-semibold transition-colors duration-150 sm:aspect-auto sm:h-11',
                                selected ? 'bg-accent text-white' : 'text-ink hover:bg-surface-muted',
                                current && !selected && 'ring-1 ring-inset ring-accent',
                            )}
                        >
                            {format(date, 'd')}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default MultiDatePicker;
