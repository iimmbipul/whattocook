'use client';

import {
    cloneElement,
    forwardRef,
    isValidElement,
    useId,
    type InputHTMLAttributes,
    type ReactElement,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export const controlClass =
    'w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink shadow-card ' +
    'placeholder:text-ink-subtle transition-[border-color,box-shadow] duration-150 ' +
    'hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 ' +
    'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted ' +
    'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15';

/**
 * Label + control + hint/error, wired together for assistive tech: the label
 * targets the control, and the hint/error are referenced by aria-describedby.
 * Pass exactly one control element as the child.
 */
export function Field({
    label,
    hint,
    error,
    required,
    className,
    children,
}: {
    label: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    required?: boolean;
    className?: string;
    children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }>;
}) {
    const autoId = useId();
    const id = (isValidElement(children) && children.props.id) || autoId;
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className={cn('space-y-1.5', className)}>
            <label htmlFor={id} className="block text-sm font-medium text-ink">
                {label}
                {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
            </label>
            {cloneElement(children, {
                id,
                'aria-describedby': describedBy,
                'aria-invalid': error ? true : undefined,
                required: required ?? children.props.required,
            })}
            {hint && !error && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
            {error && <p id={errorId} className="text-xs font-medium text-danger">{error}</p>}
        </div>
    );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
    { className, ...rest },
    ref,
) {
    return <input ref={ref} className={cn(controlClass, 'h-11', className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
    { className, rows = 3, ...rest },
    ref,
) {
    return <textarea ref={ref} rows={rows} className={cn(controlClass, 'resize-y py-2.5 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
    { className, children, ...rest },
    ref,
) {
    return (
        <div className="relative">
            <select ref={ref} className={cn(controlClass, 'h-11 cursor-pointer appearance-none pr-10', className)} {...rest}>
                {children}
            </select>
            <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        </div>
    );
});

/** Inline status message (success / error / info) announced to screen readers. */
export function Alert({ tone = 'info', children, className }: { tone?: 'info' | 'success' | 'error' | 'warning'; children: ReactNode; className?: string }) {
    const tones = {
        info: 'bg-surface-muted text-ink border-line',
        success: 'bg-success-soft text-success border-success/20',
        error: 'bg-danger-soft text-danger border-danger/20',
        warning: 'bg-warning-soft text-warning border-warning/20',
    };
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl border px-4 py-3 text-sm font-medium', tones[tone], className)}>
            {children}
        </div>
    );
}
