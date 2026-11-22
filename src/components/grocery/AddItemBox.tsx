'use client';

import { useId, useState, type FormEvent } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, TextInput } from '@/components/ui/Field';
import { saveGroceryNoteItems, understandGroceryNote } from '@/lib/grocery/actions';
import { itemName } from '@/lib/grocery/client';
import { MAX_NOTE_LENGTH, type StockLevel } from '@/lib/grocery/logic';
import type { NoteItem } from '@/lib/grocery/types';
import LevelPicker from './LevelPicker';

/**
 * "Add or report an item": the cook types a short note in any language
 * ("pyaz khatam, aata aadha"). The app shows what it understood as chips with
 * a level each; nothing is saved until the cook taps Save.
 */
export default function AddItemBox({ onSaved }: { onSaved: () => void }) {
    const { t, locale } = useLocale();
    const inputId = useId();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState<'read' | 'save' | null>(null);
    const [items, setItems] = useState<NoteItem[] | null>(null);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState('');

    const read = async (e: FormEvent) => {
        e.preventDefault();
        const note = text.trim();
        if (!note || busy) return;
        setBusy('read');
        setError('');
        setSaved('');
        try {
            const result = await understandGroceryNote(note);
            if (result.ok) {
                if (result.data.length === 0) setError(t('grocery.note.nothingFound'));
                else setItems(result.data);
            } else {
                setError(t(result.error === 'ai-unavailable' ? 'grocery.note.aiUnavailable' : 'grocery.note.failed'));
            }
        } catch {
            setError(t('grocery.note.failed'));
        }
        setBusy(null);
    };

    const save = async () => {
        if (!items || items.length === 0 || busy) return;
        setBusy('save');
        setError('');
        try {
            const result = await saveGroceryNoteItems(items);
            if (result.ok) {
                setSaved(t('grocery.note.saved', { count: items.length }));
                setItems(null);
                setText('');
                onSaved();
            } else {
                setError(t('grocery.note.failed'));
            }
        } catch {
            setError(t('grocery.note.failed'));
        }
        setBusy(null);
    };

    const setLevel = (itemId: string, level: StockLevel) =>
        setItems(list => list?.map(i => (i.itemId === itemId ? { ...i, level } : i)) ?? null);
    const remove = (itemId: string) =>
        setItems(list => {
            const next = list?.filter(i => i.itemId !== itemId) ?? [];
            return next.length > 0 ? next : null;
        });

    return (
        <div className="space-y-3">
            <form onSubmit={read} className="space-y-1.5">
                <label htmlFor={inputId} className="block text-sm font-medium text-ink">{t('grocery.note.label')}</label>
                <div className="flex gap-2">
                    <TextInput
                        id={inputId}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        maxLength={MAX_NOTE_LENGTH}
                        placeholder={t('grocery.note.placeholder')}
                        disabled={busy !== null}
                        autoComplete="off"
                    />
                    <Button type="submit" variant="secondary" loading={busy === 'read'} disabled={!text.trim() || busy === 'save'} leadingIcon={<Sparkles size={15} aria-hidden="true" />}>
                        {t('grocery.note.read')}
                    </Button>
                </div>
                <p className="text-xs text-ink-muted">{t('grocery.note.hint')}</p>
            </form>

            {items && (
                <div className="space-y-3 rounded-xl border border-line p-3">
                    <p className="text-sm font-semibold text-ink">{t('grocery.note.understood')}</p>
                    <ul className="space-y-3">
                        {items.map(item => (
                            <li key={item.itemId} className="space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-ink">
                                            {itemName(item, locale)}
                                            {locale !== 'en' && <span className="ml-1.5 text-sm font-normal text-ink-muted">{item.en}</span>}
                                        </p>
                                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                                            {item.isNew && <Badge tone="accent">{t('grocery.note.new')}</Badge>}
                                            <span>{t(`grocery.category.${item.category}`)}</span>
                                            <span aria-hidden="true">·</span>
                                            <span>“{item.source}”</span>
                                        </p>
                                    </div>
                                    <IconButton label={t('grocery.note.remove', { name: item.en })} size="sm" onClick={() => remove(item.itemId)}>
                                        <X size={16} aria-hidden="true" />
                                    </IconButton>
                                </div>
                                <LevelPicker compact value={item.level} onChange={level => setLevel(item.itemId, level)} label={item.en} disabled={busy === 'save'} />
                            </li>
                        ))}
                    </ul>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setItems(null)} disabled={busy === 'save'}>{t('common.cancel')}</Button>
                        <Button onClick={save} loading={busy === 'save'} leadingIcon={<Plus size={15} aria-hidden="true" />}>
                            {t('grocery.note.save')}
                        </Button>
                    </div>
                </div>
            )}

            {error && <Alert tone="error">{error}</Alert>}
            {saved && <Alert tone="success">{saved}</Alert>}
        </div>
    );
}
