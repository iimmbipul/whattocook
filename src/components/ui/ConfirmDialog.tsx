'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '@/context/LocaleContext';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmOptions {
    title: ReactNode;
    message?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** `danger` styles the confirm button red, for destructive actions. */
    tone?: 'default' | 'danger';
}

/**
 * Promise-based replacement for window.confirm():
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: 'Remove?', tone: 'danger' }))) return;
 *   ...and render {dialog} once in the component.
 */
export function useConfirm() {
    const { t } = useLocale();
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const resolverRef = useRef<((ok: boolean) => void) | null>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);

    const confirm = useCallback((opts: ConfirmOptions) => {
        resolverRef.current?.(false);
        setOptions(opts);
        return new Promise<boolean>(resolve => {
            resolverRef.current = resolve;
        });
    }, []);

    const settle = (ok: boolean) => {
        resolverRef.current?.(ok);
        resolverRef.current = null;
        setOptions(null);
    };

    const dialog = (
        <Dialog
            open={!!options}
            onClose={() => settle(false)}
            title={options?.title}
            size="sm"
            closeLabel={t('common.close')}
            initialFocusRef={cancelRef}
            footer={
                <>
                    <Button ref={cancelRef} variant="secondary" onClick={() => settle(false)}>
                        {options?.cancelLabel ?? t('common.cancel')}
                    </Button>
                    <Button variant={options?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
                        {options?.confirmLabel ?? t('common.confirm')}
                    </Button>
                </>
            }
        >
            {options?.message && <p className="text-[15px] leading-relaxed text-ink-muted">{options.message}</p>}
        </Dialog>
    );

    return { confirm, dialog };
}
