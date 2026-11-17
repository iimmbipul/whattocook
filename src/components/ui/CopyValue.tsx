'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { cn } from '@/lib/cn';

/** A labelled value (house code, PIN…) with a copy-to-clipboard button. */
export function CopyValue({ label, value, size = 'sm' }: { label: string; value: string; size?: 'sm' | 'lg' }) {
    const { t } = useLocale();
    const [copied, setCopied] = useState(false);
    return (
        <div className={cn('flex items-center justify-between gap-3 rounded-xl bg-surface-muted', size === 'lg' ? 'px-4 py-3' : 'px-3 py-2')}>
            <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</div>
                <div className={cn('font-mono font-semibold tracking-widest text-ink', size === 'lg' ? 'text-xl' : 'text-sm')}>{value}</div>
            </div>
            <button
                type="button"
                onClick={() => {
                    navigator.clipboard?.writeText(value).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    }).catch(() => {});
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                aria-label={`${copied ? t('common.copied') : t('common.copy')}: ${label}`}
                title={copied ? t('common.copied') : t('common.copy')}
            >
                {copied ? <Check size={16} className="text-success" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            </button>
            <span className="sr-only" aria-live="polite">{copied ? t('common.copied') : ''}</span>
        </div>
    );
}
