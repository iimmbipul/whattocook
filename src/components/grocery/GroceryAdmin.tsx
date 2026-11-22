'use client';

import { useEffect, useState } from 'react';
import { BookOpen, ShoppingBasket } from 'lucide-react';
import { useLocale } from '@/context/LocaleContext';
import { Section } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Alert, Field, Select, TextInput } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Spinner';
import {
    changeGroceryCatalogItem,
    saveGroceryCatalogItem,
    saveGrocerySettings,
    setGroceryInterval,
    setGroceryTracking,
} from '@/lib/grocery/actions';
import { groceryDayLabel, itemName, loadGroceryAdminView } from '@/lib/grocery/client';
import { CATEGORIES, type Category } from '@/lib/grocery/catalog';
import type { CatalogRow, GroceryAdminView } from '@/lib/grocery/types';
import { JarIcon } from './LevelPicker';

/** Admin → Grocery settings (owner), plus the default catalogue (app admin only). */
export default function GroceryAdmin() {
    const [view, setView] = useState<GroceryAdminView | null | undefined>(undefined);
    const reload = () => loadGroceryAdminView().then(setView);
    useEffect(() => {
        let alive = true;
        loadGroceryAdminView().then(v => {
            if (alive) setView(v);
        });
        return () => {
            alive = false;
        };
    }, []);

    if (view === undefined) return <Skeleton className="h-48 rounded-2xl" />;
    if (!view) return null;
    return (
        <>
            <GrocerySettings view={view} onChanged={reload} />
            {view.catalog && <CatalogEditor rows={view.catalog} onChanged={reload} />}
        </>
    );
}

function GrocerySettings({ view, onChanged }: { view: GroceryAdminView; onChanged: () => void }) {
    const { t, locale } = useLocale();
    const [settings, setSettings] = useState(view.settings);
    const [savingSettings, setSavingSettings] = useState(false);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

    const saveSettings = async () => {
        setSavingSettings(true);
        const result = await saveGrocerySettings(settings).catch(() => ({ ok: false }));
        setMessage({ ok: result.ok, text: t(result.ok ? 'grocery.admin.saved' : 'grocery.admin.failed') });
        setSavingSettings(false);
        if (result.ok) onChanged();
    };

    const act = async (key: string, action: () => Promise<{ ok: boolean }>) => {
        setBusy(key);
        const result = await action().catch(() => ({ ok: false }));
        setMessage({ ok: result.ok, text: t(result.ok ? 'grocery.admin.saved' : 'grocery.admin.failed') });
        setBusy(null);
        if (result.ok) {
            setDrafts({});
            onChanged();
        }
    };

    const caps = [3, 5, 8, 10, 12, 15, 20];

    return (
        <Section icon={<ShoppingBasket size={18} />} title={t('grocery.admin.title')} description={t('grocery.admin.description')}>
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('grocery.admin.lookAhead')}>
                    <Select value={settings.lookAheadDays} onChange={e => setSettings(s => ({ ...s, lookAheadDays: Number(e.target.value) }))}>
                        {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
                    </Select>
                </Field>
                <Field label={t('grocery.admin.dailyCap')}>
                    <Select value={settings.dailyCheckCap} onChange={e => setSettings(s => ({ ...s, dailyCheckCap: Number(e.target.value) }))}>
                        {caps.map(n => <option key={n} value={n}>{n}</option>)}
                    </Select>
                </Field>
                <Field label={t('grocery.admin.learning')}>
                    <Select value={settings.learning ? 'on' : 'off'} onChange={e => setSettings(s => ({ ...s, learning: e.target.value === 'on' }))}>
                        <option value="on">{t('grocery.admin.learningOn')}</option>
                        <option value="off">{t('grocery.admin.learningOff')}</option>
                    </Select>
                </Field>
            </div>
            <div className="mt-3 flex justify-end">
                <Button variant="secondary" onClick={saveSettings} loading={savingSettings}>{t('common.save')}</Button>
            </div>

            {message && <Alert tone={message.ok ? 'success' : 'error'} className="mt-3">{message.text}</Alert>}

            <h3 className="mb-1 mt-6 text-sm font-semibold text-ink">{t('grocery.admin.itemsTitle')}</h3>
            <p className="mb-3 text-sm text-ink-muted">{t('grocery.admin.itemsHelp')}</p>
            {view.items.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('grocery.admin.noItems')}</p>
            ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                    {view.items.map(item => {
                        const draft = drafts[item.itemId] ?? String(item.intervalDays);
                        const days = Number(draft);
                        const valid = Number.isInteger(days) && days >= 1 && days <= 30;
                        return (
                            <li key={item.itemId} className={item.active ? 'p-3' : 'p-3 opacity-60'}>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                    <span className="text-ink-subtle"><JarIcon level={item.level} size={18} /></span>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-ink">
                                            {itemName(item, locale)}
                                            {locale !== 'en' && <span className="ml-1.5 text-sm font-normal text-ink-muted">{item.en}</span>}
                                        </p>
                                        <p className="text-xs text-ink-muted">
                                            {t(`grocery.level.${item.level}`)} · {t('grocery.pantry.nextCheck', { day: groceryDayLabel(item.nextCheckDate < view.today ? view.today : item.nextCheckDate, view.today, t, locale) })}
                                            {!item.active && ` · ${t('grocery.admin.notTracked')}`}
                                        </p>
                                        {item.lastChange && (
                                            <p className="text-xs text-ink-muted">
                                                {t('grocery.admin.learned', { from: item.lastChange.from, to: item.lastChange.to, observed: item.lastChange.observedDays, day: groceryDayLabel(item.lastChange.date, view.today, t, locale) })}
                                            </p>
                                        )}
                                    </div>
                                    <Badge tone={item.intervalSource === 'pinned' ? 'accent' : item.intervalSource === 'learned' ? 'success' : 'neutral'}>
                                        {t(`grocery.admin.source.${item.intervalSource}`)}
                                    </Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-2 text-sm text-ink">
                                        {t('grocery.admin.every')}
                                        <TextInput
                                            type="number"
                                            min={1}
                                            max={30}
                                            inputMode="numeric"
                                            value={draft}
                                            onChange={e => setDrafts(d => ({ ...d, [item.itemId]: e.target.value }))}
                                            className="h-9 w-20"
                                            aria-label={t('grocery.admin.intervalFor', { name: item.en })}
                                        />
                                        {t('grocery.admin.daysWord')}
                                    </label>
                                    <Button size="sm" variant="secondary" disabled={!valid || days === item.intervalDays && item.intervalSource === 'pinned'} loading={busy === `pin-${item.itemId}`} onClick={() => act(`pin-${item.itemId}`, () => setGroceryInterval(item.itemId, days))}>
                                        {t('grocery.admin.pin')}
                                    </Button>
                                    {item.intervalSource === 'pinned' && (
                                        <Button size="sm" variant="ghost" loading={busy === `auto-${item.itemId}`} onClick={() => act(`auto-${item.itemId}`, () => setGroceryInterval(item.itemId, null))}>
                                            {t('grocery.admin.unpin')}
                                        </Button>
                                    )}
                                    <Button size="sm" variant="ghost" loading={busy === `track-${item.itemId}`} onClick={() => act(`track-${item.itemId}`, () => setGroceryTracking(item.itemId, !item.active))}>
                                        {item.active ? t('grocery.pantry.stopTracking') : t('grocery.pantry.trackAgain')}
                                    </Button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Section>
    );
}

type CatalogForm = { id: string; en: string; hi: string; or: string; category: Category; intervalDays: string; aliases: string; isNew: boolean };

function CatalogEditor({ rows, onChanged }: { rows: CatalogRow[]; onChanged: () => void }) {
    const { t } = useLocale();
    const [query, setQuery] = useState('');
    const [form, setForm] = useState<CatalogForm | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    const q = query.trim().toLowerCase();
    const shown = q ? rows.filter(r => [r.id, r.en, r.hi, r.or, ...r.aliases].some(s => s.toLowerCase().includes(q))) : rows;

    const edit = (r: CatalogRow) =>
        setForm({ id: r.id, en: r.en, hi: r.hi, or: r.or, category: r.category, intervalDays: String(r.intervalDays), aliases: r.aliases.join(', '), isNew: false });

    const save = async () => {
        if (!form) return;
        setBusy('save');
        setError('');
        const result = await saveGroceryCatalogItem({
            id: form.id.trim().toLowerCase(),
            en: form.en,
            hi: form.hi,
            or: form.or,
            category: form.category,
            intervalDays: Number(form.intervalDays),
            aliases: form.aliases.split(',').map(a => a.trim()).filter(Boolean),
        }).catch(() => ({ ok: false }));
        setBusy(null);
        if (result.ok) {
            setForm(null);
            onChanged();
        } else setError(t('grocery.admin.catalogInvalid'));
    };

    const change = async (id: string, action: 'hide' | 'show' | 'reset') => {
        setBusy(`${action}-${id}`);
        const result = await changeGroceryCatalogItem(id, action).catch(() => ({ ok: false }));
        setBusy(null);
        if (result.ok) onChanged();
        else setError(t('grocery.admin.failed'));
    };

    return (
        <Section
            icon={<BookOpen size={18} />}
            title={t('grocery.admin.catalogTitle')}
            description={t('grocery.admin.catalogDescription')}
            action={<Button size="sm" variant="secondary" onClick={() => setForm({ id: '', en: '', hi: '', or: '', category: 'vegetables', intervalDays: '7', aliases: '', isNew: true })}>{t('grocery.admin.addCatalog')}</Button>}
        >
            <TextInput value={query} onChange={e => setQuery(e.target.value)} placeholder={t('grocery.admin.search')} aria-label={t('grocery.admin.search')} className="mb-3" />
            {error && !form && <Alert tone="error" className="mb-3">{error}</Alert>}
            <ul className="max-h-[480px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                {shown.map(r => (
                    <li key={r.id} className={r.hidden ? 'flex flex-wrap items-center gap-2 p-3 opacity-60' : 'flex flex-wrap items-center gap-2 p-3'}>
                        <div className="min-w-0 flex-1">
                            <p className="font-medium text-ink">{r.en} <span className="font-normal text-ink-muted">· {r.hi} · {r.or}</span></p>
                            <p className="text-xs text-ink-muted">
                                {t(`grocery.category.${r.category}`)} · {r.intervalDays === 1 ? t('grocery.admin.everyDay') : t('grocery.admin.everyDays', { count: r.intervalDays })}
                                {r.overridden && ` · ${t('grocery.admin.edited')}`}{r.hidden && ` · ${t('grocery.admin.hidden')}`}
                            </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => edit(r)}>{t('grocery.admin.edit')}</Button>
                        <Button size="sm" variant="ghost" loading={busy === `${r.hidden ? 'show' : 'hide'}-${r.id}`} onClick={() => change(r.id, r.hidden ? 'show' : 'hide')}>
                            {r.hidden ? t('grocery.admin.show') : t('grocery.admin.hide')}
                        </Button>
                        {r.overridden && (
                            <Button size="sm" variant="ghost" loading={busy === `reset-${r.id}`} onClick={() => change(r.id, 'reset')}>{t('grocery.admin.reset')}</Button>
                        )}
                    </li>
                ))}
            </ul>

            <Dialog
                open={form !== null}
                onClose={() => setForm(null)}
                title={form?.isNew ? t('grocery.admin.addCatalog') : t('grocery.admin.editCatalog')}
                closeLabel={t('common.close')}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setForm(null)}>{t('common.cancel')}</Button>
                        <Button onClick={save} loading={busy === 'save'}>{t('common.save')}</Button>
                    </div>
                }
            >
                {form && (
                    <div className="space-y-3">
                        {form.isNew && (
                            <Field label={t('grocery.admin.fieldId')} hint={t('grocery.admin.fieldIdHint')}>
                                <TextInput value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} />
                            </Field>
                        )}
                        <Field label={t('grocery.admin.fieldEn')}><TextInput value={form.en} onChange={e => setForm({ ...form, en: e.target.value })} /></Field>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label={t('grocery.admin.fieldHi')}><TextInput value={form.hi} onChange={e => setForm({ ...form, hi: e.target.value })} lang="hi" /></Field>
                            <Field label={t('grocery.admin.fieldOr')}><TextInput value={form.or} onChange={e => setForm({ ...form, or: e.target.value })} lang="or" /></Field>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label={t('grocery.admin.fieldCategory')}>
                                <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Category })}>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{t(`grocery.category.${c}`)}</option>)}
                                </Select>
                            </Field>
                            <Field label={t('grocery.admin.fieldInterval')}>
                                <TextInput type="number" min={1} max={30} value={form.intervalDays} onChange={e => setForm({ ...form, intervalDays: e.target.value })} />
                            </Field>
                        </div>
                        <Field label={t('grocery.admin.fieldAliases')} hint={t('grocery.admin.fieldAliasesHint')}>
                            <TextInput value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} />
                        </Field>
                        {error && <Alert tone="error">{error}</Alert>}
                    </div>
                )}
            </Dialog>
        </Section>
    );
}
