'use client';

import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Section } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { loadRatingsDashboard } from '@/lib/ratings/client';
import { setRatingNamesVisible } from '@/lib/ratings/actions';

type Mode = 'anonymous' | 'named';

/** Owner setting: whether cooks see who wrote each rating. Anonymous by default. */
export default function RatingPrivacySetting({ uid }: { uid: string }) {
    const { t } = useLocale();
    const [mode, setMode] = useState<Mode | null>(null);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        let alive = true;
        loadRatingsDashboard(uid).then(d => {
            if (alive) setMode(d?.namesVisible ? 'named' : 'anonymous');
        });
        return () => {
            alive = false;
        };
    }, [uid]);

    const change = async (next: Mode) => {
        if (next === mode) return;
        const previous = mode;
        setMode(next);
        setMessage(null);
        const ok = await setRatingNamesVisible(next === 'named').catch(() => false);
        if (!ok) setMode(previous);
        else void loadRatingsDashboard(uid, { fresh: true });
        setMessage({ ok, text: ok ? t('ratings.privacy.saved') : t('ratings.privacy.error') });
    };

    return (
        <Section icon={<EyeOff size={18} />} title={t('ratings.privacy.title')} description={t('ratings.privacy.description')}>
            {mode && (
                <Segmented<Mode>
                    label={t('ratings.privacy.title')}
                    value={mode}
                    onChange={change}
                    options={[
                        { value: 'anonymous', label: t('ratings.privacy.anonymous') },
                        { value: 'named', label: t('ratings.privacy.named') },
                    ]}
                />
            )}
            <p role="status" className={message ? `mt-2 text-sm ${message.ok ? 'text-success' : 'text-danger'}` : 'sr-only'}>
                {message?.text ?? ''}
            </p>
        </Section>
    );
}
