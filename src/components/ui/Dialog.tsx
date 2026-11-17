'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

const FOCUSABLE =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    /** Sticky footer, usually the primary/secondary actions. */
    footer?: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    /** When false, Escape / backdrop / close button do nothing (e.g. while saving). */
    dismissible?: boolean;
    closeLabel?: string;
    /** Element to focus first; defaults to the first focusable control. */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

/**
 * Accessible modal: bottom sheet on phones, centred dialog from `sm` up.
 * Handles Escape, focus trapping, focus restore and background scroll lock.
 */
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
    dismissible = true,
    closeLabel = 'Close',
    initialFocusRef,
}: DialogProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const descId = useId();
    const onCloseRef = useRef(onClose);
    const dismissibleRef = useRef(dismissible);
    useEffect(() => {
        onCloseRef.current = onClose;
        dismissibleRef.current = dismissible;
    });

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';

        const panel = panelRef.current;
        const first = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
        first?.focus({ preventScroll: true });

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (dismissibleRef.current) {
                    e.stopPropagation();
                    onCloseRef.current();
                }
                return;
            }
            if (e.key !== 'Tab' || !panel) return;
            const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
            if (items.length === 0) {
                e.preventDefault();
                return;
            }
            const firstItem = items[0];
            const lastItem = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstItem) {
                e.preventDefault();
                lastItem.focus();
            } else if (!e.shiftKey && document.activeElement === lastItem) {
                e.preventDefault();
                firstItem.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = overflow;
            previouslyFocused?.focus?.({ preventScroll: true });
        };
    }, [open, initialFocusRef]);

    if (!open || typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
            <div
                className="absolute inset-0 animate-fade-in bg-ink/45 backdrop-blur-[2px]"
                aria-hidden="true"
                onClick={() => dismissible && onClose()}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descId : undefined}
                tabIndex={-1}
                className={cn(
                    'relative flex max-h-[92dvh] w-full flex-col bg-surface shadow-overlay outline-none',
                    'animate-sheet-up rounded-t-3xl sm:animate-pop-in sm:rounded-2xl',
                    widths[size],
                )}
            >
                <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
                <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-lg font-semibold leading-tight text-ink">{title}</h2>
                        {description && <p id={descId} className="mt-1 text-sm text-ink-muted">{description}</p>}
                    </div>
                    {dismissible && (
                        <IconButton label={closeLabel} size="sm" onClick={onClose} className="-mr-1.5 -mt-1">
                            <X size={18} />
                        </IconButton>
                    )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">{children}</div>
                {footer && (
                    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:pb-4">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
