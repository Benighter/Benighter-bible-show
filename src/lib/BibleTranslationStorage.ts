import type { BibleTranslation } from './BibleTranslations';

const DATABASE_NAME = 'bible-show';
const DATABASE_VERSION = 1;
const STORE_NAME = 'translations';
const TRANSLATIONS_KEY = 'all';

type TranslationRecord = {
    key: string;
    value: BibleTranslation[];
};

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
    });
}

export async function loadStoredTranslations(): Promise<BibleTranslation[]> {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(TRANSLATIONS_KEY);

        request.onsuccess = () => {
            const record = request.result as TranslationRecord | undefined;
            resolve(record?.value ?? []);
        };
        request.onerror = () => reject(request.error ?? new Error('Unable to read stored translations.'));

        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to complete translation read.'));
    });
}

export async function saveStoredTranslations(translations: BibleTranslation[]): Promise<void> {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put({ key: TRANSLATIONS_KEY, value: translations } satisfies TranslationRecord);

        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to store translations.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Translation storage was aborted.'));
    });
}