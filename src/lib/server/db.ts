import 'server-only';

import {
    FieldValue,
    Timestamp,
    type CollectionReference,
    type DocumentData,
    type DocumentReference,
    type DocumentSnapshot as AdminDocumentSnapshot,
    type OrderByDirection,
    type Query,
    type QuerySnapshot as AdminQuerySnapshot,
    type SetOptions,
    type UpdateData,
    type WhereFilterOp,
    type WriteBatch,
} from 'firebase-admin/firestore';
import { adminFirestore } from './firebaseAdmin';

/**
 * Server-side Firestore access through firebase-admin, exposed with the same
 * small subset of the modular client API (`doc`, `getDoc`, `query`, `where`,
 * `writeBatch`, …) the server code was written against. Server modules import
 * from here instead of 'firebase/firestore' + '../firebase', so their logic is
 * unchanged while every read and write now runs with service-account
 * credentials (and therefore works with locked-down security rules).
 *
 * Only what the app uses is implemented. Snapshots keep the client SDK's
 * shape: `snap.exists()` is a method and `data()` is typed accordingly.
 */

export { Timestamp };
export type { DocumentData, DocumentReference, CollectionReference, WriteBatch };

/** Stand-in for the client SDK's `db` argument; the real instance is created lazily. */
export const db = Object.freeze({ kind: 'firebase-admin' as const });
type Db = typeof db;

export interface DocumentSnapshot<T = DocumentData> {
    readonly id: string;
    readonly ref: DocumentReference;
    exists(): this is QueryDocumentSnapshot<T>;
    data(): T | undefined;
}

export interface QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
    data(): T;
}

export interface QuerySnapshot<T = DocumentData> {
    readonly docs: QueryDocumentSnapshot<T>[];
    readonly empty: boolean;
    readonly size: number;
    forEach(callback: (snapshot: QueryDocumentSnapshot<T>) => void): void;
}

function wrapDocument(snapshot: AdminDocumentSnapshot): DocumentSnapshot {
    return {
        id: snapshot.id,
        ref: snapshot.ref,
        exists: () => snapshot.exists,
        data: () => snapshot.data(),
    } as DocumentSnapshot;
}

function wrapQuery(snapshot: AdminQuerySnapshot): QuerySnapshot {
    const docs = snapshot.docs.map(d => wrapDocument(d) as QueryDocumentSnapshot);
    return {
        docs,
        empty: snapshot.empty,
        size: snapshot.size,
        forEach: callback => docs.forEach(callback),
    };
}

const joinPath = (path: string, segments: string[]) => [path, ...segments].join('/');

export function collection(_db: Db, path: string, ...segments: string[]): CollectionReference {
    return adminFirestore().collection(joinPath(path, segments));
}

/** `doc(db, path, ...segments)` or `doc(collectionRef)` for a new auto-ID document. */
export function doc(parent: Db | CollectionReference, path?: string, ...segments: string[]): DocumentReference {
    if (parent === db) {
        if (path === undefined) throw new Error('doc(db) requires a path');
        return adminFirestore().doc(joinPath(path, segments));
    }
    const coll = parent as CollectionReference;
    return path === undefined ? coll.doc() : coll.doc(joinPath(path, segments));
}

type QueryConstraint = (q: Query) => Query;

export const where = (field: string, op: WhereFilterOp, value: unknown): QueryConstraint => q => q.where(field, op, value);
export const orderBy = (field: string, direction: OrderByDirection = 'asc'): QueryConstraint => q => q.orderBy(field, direction);
export const limit = (n: number): QueryConstraint => q => q.limit(n);

export function query(base: Query, ...constraints: QueryConstraint[]): Query {
    return constraints.reduce((q, apply) => apply(q), base);
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    return wrapDocument(await ref.get());
}

export async function getDocs(q: Query): Promise<QuerySnapshot> {
    return wrapQuery(await q.get());
}

export async function getCountFromServer(q: Query): Promise<{ data(): { count: number } }> {
    return q.count().get();
}

export async function setDoc(ref: DocumentReference, data: DocumentData, options?: SetOptions): Promise<void> {
    if (options) await ref.set(data, options);
    else await ref.set(data);
}

export async function updateDoc(ref: DocumentReference, data: UpdateData<DocumentData>): Promise<void> {
    await ref.update(data);
}

export async function addDoc(coll: CollectionReference, data: DocumentData): Promise<DocumentReference> {
    return coll.add(data);
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
    await ref.delete();
}

export function writeBatch(_db: Db): WriteBatch {
    return adminFirestore().batch();
}

export const serverTimestamp = () => FieldValue.serverTimestamp();
export const deleteField = () => FieldValue.delete();
export const arrayUnion = (...elements: unknown[]) => FieldValue.arrayUnion(...elements);
export const increment = (n: number) => FieldValue.increment(n);
