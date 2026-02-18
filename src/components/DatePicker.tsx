"use client";

import React from 'react';
import { format, addDays, isSameDay } from 'date-fns';

interface DatePickerProps {
    selectedDate: Date;
    onDateSelect: (date: Date) => void;
}

const DatePicker = ({ selectedDate, onDateSelect }: DatePickerProps) => {
    // Generate 14 days starting from today
    const dates = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

    return (
        <div className="flex flex-col items-center justify-center p-8 bg-brand-light/30 rounded-3xl min-h-[200px]">
            <div className="flex space-x-3 overflow-x-auto pb-4 scrollbar-hide bg-white p-6 rounded-[40px] shadow-sm max-w-full border border-brand-light">
                {dates.map((date, index) => {
                    const isSelected = isSameDay(date, selectedDate);

                    return (
                        <button
                            key={index}
                            onClick={() => onDateSelect(date)}
                            className={`flex flex-col items-center min-w-[65px] transition-all duration-300 rounded-full py-4 
                ${isSelected ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20' : 'bg-brand-light/20 text-brand-dark hover:bg-brand-light/40'}`}
                        >
                            {/* Day Name (S, M, T, W...) */}
                            <span className="text-xs font-medium mb-4 uppercase opacity-80">
                                {format(date, 'eeeeee')}
                            </span>

                            {/* Day Number with Ring Effect */}
                            <div className="relative flex items-center justify-center w-12 h-12">
                                {isSelected && (
                                    <>
                                        {/* The Circular Progress-style border */}
                                        <div className="absolute inset-0 border-2 border-white/30 rounded-full"></div>
                                        <div className="absolute inset-0 border-2 border-t-white border-r-white border-b-transparent border-l-transparent rounded-full rotate-45"></div>
                                        {/* Small Dot */}
                                        <div className="absolute -left-1 bottom-2 w-1.5 h-1.5 bg-brand-secondary rounded-full border border-brand-primary"></div>
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
        </div>
    );
};

export default DatePicker;
