'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { useLocale } from '@/context/LocaleContext';

type CollectionName = 'dailymenu' | 'users';

export default function AdminJsonEditor() {
    const [selectedCollection, setSelectedCollection] = useState<CollectionName>('dailymenu');
    const [jsonData, setJsonData] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const { t } = useLocale();

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCollection]);

    const fetchData = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const querySnapshot = await getDocs(collection(db, selectedCollection));
            const data = querySnapshot.docs.map(doc => {
                const d = doc.data();
                return { _id: doc.id, ...d };
            });
            setJsonData(JSON.stringify(data, null, 2));
        } catch (error: any) {
            console.error("Error fetching data:", error);
            setMessage({ type: 'error', text: `Failed to fetch data: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async () => {
        if (!confirm(`Are you sure you want to overwrite the "${selectedCollection}" collection with this data? This cannot be undone.`)) {
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            let parsedData;
            try {
                parsedData = JSON.parse(jsonData);
            } catch (e) {
                throw new Error("Invalid JSON format");
            }

            if (!Array.isArray(parsedData)) {
                throw new Error("JSON data must be an array of objects");
            }

            const currentDocsSnapshot = await getDocs(collection(db, selectedCollection));
            const currentIds = new Set(currentDocsSnapshot.docs.map(d => d.id));
            const newIds = new Set();

            const batchArray = [];
            let batch = writeBatch(db);
            let operationCount = 0;

            for (const item of parsedData) {
                if (!item._id) {
                    const newDocRef = doc(collection(db, selectedCollection));
                    item._id = newDocRef.id;
                }

                const docId = item._id;
                newIds.add(docId);

                const { _id, ...dataToSave } = item;

                if (dataToSave.created_at && typeof dataToSave.created_at === 'string') {
                    const d = new Date(dataToSave.created_at);
                    if (!isNaN(d.getTime())) { /* handle if needed */ }
                }

                const docRef = doc(db, selectedCollection, docId);
                batch.set(docRef, dataToSave);
                operationCount++;

                if (operationCount >= 400) {
                    batchArray.push(batch);
                    batch = writeBatch(db);
                    operationCount = 0;
                }
            }

            for (const oldId of currentIds) {
                if (!newIds.has(oldId)) {
                    batch.delete(doc(db, selectedCollection, oldId as string));
                    operationCount++;

                    if (operationCount >= 400) {
                        batchArray.push(batch);
                        batch = writeBatch(db);
                        operationCount = 0;
                    }
                }
            }

            if (operationCount > 0) {
                batchArray.push(batch);
            }

            for (const b of batchArray) {
                await b.commit();
            }

            setMessage({ type: 'success', text: 'Database updated successfully!' });
            fetchData();

        } catch (error: any) {
            console.error("Error updating database:", error);
            setMessage({ type: 'error', text: `Failed to update: ${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-xl p-8 mt-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('adminEditor.title')}</h2>
                <p className="text-gray-600">{t('adminEditor.description')}</p>
            </div>

            <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">{t('adminEditor.selectCollection')}</label>
                <select
                    value={selectedCollection}
                    onChange={(e) => setSelectedCollection(e.target.value as CollectionName)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                >
                    <option value="dailymenu">{t('adminEditor.dailyMenuOption')}</option>
                    <option value="users">{t('adminEditor.usersOption')}</option>
                </select>
            </div>

            {message && (
                <div className={`mb-4 px-4 py-3 rounded-lg border ${message.type === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700'
                    }`}>
                    {message.type === 'success' ? '✅' : '❌'} {message.text}
                </div>
            )}

            <div className="space-y-4">
                <textarea
                    value={jsonData}
                    onChange={(e) => setJsonData(e.target.value)}
                    className="w-full h-96 font-mono text-sm p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                    placeholder={t('adminEditor.loadingPlaceholder')}
                    spellCheck={false}
                />

                <div className="flex gap-4">
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-4 rounded-lg transition-all duration-200"
                    >
                        {t('adminEditor.refreshButton')}
                    </button>
                    <button
                        onClick={handleUpdate}
                        disabled={loading}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50"
                    >
                        {loading ? t('adminEditor.processingButton') : t('adminEditor.updateButton')}
                    </button>
                </div>
                <p className="text-xs text-gray-500 text-center">
                    {t('adminEditor.warningText')}
                </p>
            </div>
        </div>
    );
}
