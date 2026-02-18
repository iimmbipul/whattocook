"use client";

import React from 'react';
import { format, addDays, isSameDay } from 'date-fns';

interface MultiDatePickerProps {
    selectedDates: Date[];
    onDateToggle: (date: Date) => void;
}

const MultiDatePicker = ({ selectedDates, onDateToggle }: MultiDatePickerProps) => {
    // Generate dates for the entire current month
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const daysInMonth = endOfMonth.getDate();

    const dates = Array.from({ length: daysInMonth }, (_, i) => addDays(startOfMonth, i));

    const isDateSelected = (date: Date) => {
        return selectedDates.some(d => isSameDay(d, date));
    };

    return (
        <div className="flex flex-col items-center justify-center py-6 px-4 bg-brand-light/30 rounded-3xl min-h-[180px]">
            <div className="flex space-x-3 overflow-x-auto pb-4 scrollbar-hide bg-white p-6 rounded-[40px] shadow-sm max-w-full border border-brand-light w-full">
                {dates.map((date, index) => {
                    const isSelected = isDateSelected(date);

                    return (
                        <button
                            key={index}
                            onClick={() => onDateToggle(date)}
                            className={`flex flex-col items-center min-w-[65px] transition-all duration-300 rounded-full py-4 shrink-0
                ${isSelected ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20 scale-105' : 'bg-brand-light/20 text-brand-dark hover:bg-brand-light/40'}`}
                        >
                            {/* Day Name (S, M, T, W...) */}
                            <span className="text-xs font-medium mb-4 uppercase opacity-80">
                                {format(date, 'eee')}
                            </span>

                            {/* Day Number with Ring Effect */}
                            <div className="relative flex items-center justify-center w-12 h-12">
                                {isSelected && (
                                    <>
                                        {/* The Circular Progress-style border */}
                                        <div className="absolute inset-0 border-2 border-white/30 rounded-full"></div>
                                        {/* Small Dot */}
                                        <div className="absolute -right-1 top-0 w-2 h-2 bg-brand-secondary rounded-full border border-brand-primary"></div>
                                    </>
                                )}

                                <span className={`text-lg font-semibold ${isSelected ? 'text-white' : 'text-brand-darkest'}`}>
                                    {format(date, 'dd')}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>
            <p className="text-xs text-brand-dark/50 mt-4 font-medium">Click dates to select/deselect multiple</p>
        </div>
    );
};

export default MultiDatePicker;
