'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, writeBatch, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

type CollectionName = 'dailymenu' | 'users';

export default function AdminJsonEditor() {
    const [selectedCollection, setSelectedCollection] = useState<CollectionName>('dailymenu');
    const [jsonData, setJsonData] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Fetch data when collection changes
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
                // Convert timestamps to string/Date for better JSON readability if needed,
                // but for raw editing, we generally keep the data structure.
                // However, Firestore Timestamps don't serialize nicely to JSON directly (they become objects with seconds/nanoseconds).
                // For editable JSON, we'll keep them as is or converting them might be tricky if we want to write them back as Timestamps.
                // Let's rely on Firestore's data() raw output but maybe serialize dates.

                const d = doc.data();
                // Add ID to the object for reference, but we need to handle it on save
                return { _id: doc.id, ...d };
            });

            // Custom replacer to handle Firestore Timestamps or Dates if necessary?
            // For now standard stringify.
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

            // We need to determine what to add/update and what to delete (if we want an exact mirror).
            // Strategy: 
            // 1. Get all current document IDs in the collection.
            // 2. Iterate over the new data. Update/Set each document. Keep track of processed IDs.
            // 3. Delete documents that were not in the new data (optional, but typical for "replace" logic).

            // However, Firestore has batch limits (500 ops).
            // We'll process in chunks of 400 to be safe.

            const currentDocsSnapshot = await getDocs(collection(db, selectedCollection));
            const currentIds = new Set(currentDocsSnapshot.docs.map(d => d.id));
            const newIds = new Set();

            const batchArray = [];
            let batch = writeBatch(db);
            let operationCount = 0;

            for (const item of parsedData) {
                if (!item._id) {
                    // if no _id, we could auto-generate, but for 'update' ideally we have one.
                    // If strictly new, create a ref.
                    const newDocRef = doc(collection(db, selectedCollection));
                    item._id = newDocRef.id;
                }

                const docId = item._id;
                newIds.add(docId);

                // Prepare data for saving
                const { _id, ...dataToSave } = item;

                // Handle special fields if needed (like converting string dates back to timestamps?)
                // For this generic editor, we will rely on what is passed. 
                // Note: If the user edited a date string, it will be saved as string unless we coerce it.
                // This is a common issue with raw JSON editors for Firestore. 
                // We will try to detect 'created_at' / 'updated_at' fields if they look like dates.

                // Simple heuristic for specific fields we know are dates in this app
                if (dataToSave.created_at && typeof dataToSave.created_at === 'string') {
                    // Try to convert back to date/timestamp if valid
                    const d = new Date(dataToSave.created_at);
                    // Firestore can take Date objects directly
                    if (!isNaN(d.getTime())) {
                        // dataToSave.created_at = d; // Firestore SDK handles JS Date objects
                        // actually dataToSave.created_at is likely an object {seconds...} if we didn't transform it on load.
                        // But JSON.stringify would have turned {seconds...} into specific structure or if it was a Date object, into a string.
                    }
                }
                // If the JSON has "seconds" and "nanoseconds" properties, we should probably convert to Timestamp?
                // Let's assume the user knows what they are doing or just saving strings/maps. 

                const docRef = doc(db, selectedCollection, docId);
                batch.set(docRef, dataToSave);
                operationCount++;

                if (operationCount >= 400) {
                    batchArray.push(batch);
                    batch = writeBatch(db);
                    operationCount = 0;
                }
            }

            // Delete removed docs
            for (const oldId of currentIds) {
                if (!newIds.has(oldId)) {
                    batch.delete(doc(db, selectedCollection, oldId));
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

            // Commit all batches
            for (const b of batchArray) {
                await b.commit();
            }

            setMessage({ type: 'success', text: 'Database updated successfully!' });
            // Refresh
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
                <h2 className="text-2xl font-bold text-gray-800 mb-2">🗄️ Raw Data Editor</h2>
                <p className="text-gray-600">View and modify all data in JSON format.</p>
            </div>

            <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Select Collection</label>
                <select
                    value={selectedCollection}
                    onChange={(e) => setSelectedCollection(e.target.value as CollectionName)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-800"
                >
                    <option value="dailymenu">Daily Menu (Meals)</option>
                    <option value="users">Users</option>
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
                    placeholder="Loading specific data..."
                    spellCheck={false}
                />

                <div className="flex gap-4">
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-4 rounded-lg transition-all duration-200"
                    >
                        🔄 Refresh Data
                    </button>
                    <button
                        onClick={handleUpdate}
                        disabled={loading}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50"
                    >
                        {loading ? 'Processing...' : '💾 Update Database'}
                    </button>
                </div>
                <p className="text-xs text-gray-500 text-center">
                    ⚠️ Updates will sync exactly with what is in the box. Missing IDs will be deleted from the database.
                </p>
            </div>
        </div>
    );
}
