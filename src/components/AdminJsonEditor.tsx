'use client';

import { useState, useEffect } from 'react';
import { Database } from 'lucide-react';
import { adminLoadCollection, adminReplaceCollection } from '@/lib/adminData';
import { useLocale } from '@/context/LocaleContext';
import { Section } from './ui/Card';
import { Alert, Field, Select, TextArea } from './ui/Field';
import { Button } from './ui/Button';
import { useConfirm } from './ui/ConfirmDialog';

type CollectionName = 'menu_templates' | 'users' | 'category_templates' | 'meals_T6GggZ7CrPSSoY9uEydL' | 'households/T6GggZ7CrPSSoY9uEydL/meals';

export default function AdminJsonEditor() {
    const [selectedCollection, setSelectedCollection] = useState<CollectionName>('menu_templates');
    const [jsonData, setJsonData] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const { t } = useLocale();
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCollection]);

    // Reads and writes go through app-admin-only server actions; the browser
    // no longer talks to these collections directly.
    const fetchData = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const result = await adminLoadCollection(selectedCollection);
            if (result.ok) {
                setJsonData(result.json);
            } else {
                setJsonData('');
                setMessage({ type: 'error', text: `Failed to fetch data: ${result.error}` });
            }
        } catch (error) {
            console.error("Error fetching data:", error);
            setMessage({ type: 'error', text: `Failed to fetch data: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async () => {
        const ok = await confirm({
            title: `Overwrite “${selectedCollection}”?`,
            message: 'The whole collection is replaced with the JSON in the editor. This cannot be undone.',
            confirmLabel: 'Overwrite collection',
            tone: 'danger',
        });
        if (!ok) return;

        setLoading(true);
        setMessage(null);

        try {
            const result = await adminReplaceCollection(selectedCollection, jsonData);
            if (!result.ok) throw new Error(result.error);

            setMessage({ type: 'success', text: 'Database updated successfully.' });
            fetchData();

        } catch (error) {
            console.error("Error updating database:", error);
            setMessage({ type: 'error', text: `Failed to update: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Section icon={<Database size={18} />} tone="danger" title={t('adminEditor.title')} description={t('adminEditor.description')}>
            {dialog}
            <div className="space-y-4">
                <Field label={t('adminEditor.selectCollection')}>
                    <Select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value as CollectionName)}>
                        <option value="menu_templates">{t('adminEditor.dailyMenuOption')}</option>
                        <option value="users">{t('adminEditor.usersOption')}</option>
                        <option value="category_templates">{t('adminEditor.categoryTemplatesOption')}</option>
                        <option value="meals_T6GggZ7CrPSSoY9uEydL">meals_T6GggZ7CrPSSoY9uEydL</option>
                        <option value="households/T6GggZ7CrPSSoY9uEydL/meals">households/T6GggZ7CrPSSoY9uEydL/meals</option>
                    </Select>
                </Field>

                {message && <Alert tone={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>}

                <Field label="JSON">
                    <TextArea
                        value={jsonData}
                        onChange={(e) => setJsonData(e.target.value)}
                        className="h-96 font-mono text-[13px]"
                        placeholder={t('adminEditor.loadingPlaceholder')}
                        spellCheck={false}
                    />
                </Field>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="secondary" onClick={fetchData} disabled={loading}>{t('adminEditor.refreshButton')}</Button>
                    <Button variant="danger" onClick={handleUpdate} loading={loading} loadingText={t('adminEditor.processingButton')}>
                        {t('adminEditor.updateButton')}
                    </Button>
                </div>
                <p className="text-xs text-ink-muted">{t('adminEditor.warningText')}</p>
            </div>
        </Section>
    );
}
