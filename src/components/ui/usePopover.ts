'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Open/close state for a disclosure popover (menu, panel): closes on Escape
 * (returning focus to the trigger) and on pointer-down outside the container.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<T>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return { open, setOpen, toggle: () => setOpen(v => !v), containerRef, triggerRef };
}
