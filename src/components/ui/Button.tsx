import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap select-none ' +
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white shadow-card hover:bg-accent-hover',
    secondary: 'bg-surface text-ink border border-line shadow-card hover:bg-surface-muted hover:border-line-strong',
    soft: 'bg-accent-soft text-accent-strong hover:bg-[#d8e6df]',
    ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
    danger: 'bg-danger text-white shadow-card hover:bg-danger-hover',
    'danger-soft': 'bg-danger-soft text-danger hover:bg-[#fbe2de]',
};

const sizes: Record<ButtonSize, string> = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-11 px-4 text-[15px]',
    lg: 'h-12 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    /** Shown instead of children while `loading`. */
    loadingText?: ReactNode;
    leadingIcon?: ReactNode;
    fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', loading = false, loadingText, leadingIcon, fullWidth, className, children, disabled, type = 'button', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
            {...rest}
        >
            {loading ? <Spinner size={16} /> : leadingIcon}
            {loading && loadingText ? loadingText : children}
        </button>
    );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** Required: icon-only buttons need an accessible name. */
    label: string;
    variant?: ButtonVariant;
    size?: 'sm' | 'md';
}

const iconSizes = { sm: 'h-9 w-9', md: 'h-11 w-11' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            aria-label={label}
            title={label}
            className={cn(base, 'px-0', variants[variant], iconSizes[size], className)}
            {...rest}
        >
            {children}
        </button>
    );
});
