import type { AppSettings, MediaItem, PresentationItem, SongCategory, SongItem, ThemeItem, UserWorkspace } from './AppData';
import { defaultAppSettings } from './AppData';
import { sanitizeTranslation, type BibleTranslation, type SlideItem } from './BibleTranslations';
import { getSupabaseAccessToken, supabase, supabasePublishableKey, supabaseUrl } from './supabase';

type Unsubscribe = () => void;

type WorkspaceDocumentRow = {
    user_id: string;
    document_id: string;
    payload: unknown;
    updated_at: string;
};

type TranslationRow = {
    user_id: string;
    translation_id: string;
    name: string;
    short_name: string;
    source_file_name: string | null;
    updated_at: string;
};

type TranslationChunkRow = {
    user_id: string;
    translation_id: string;
    chunk_index: number;
    verses: unknown;
    updated_at: string;
};

type LoadStoredTranslationsOptions = {
    translationIds?: string[];
    includeVerses?: boolean;
};

const WORKSPACE_TABLE = 'user_workspace_documents';
const TRANSLATIONS_TABLE = 'user_translations';
const TRANSLATION_CHUNKS_TABLE = 'user_translation_chunks';
const VERSE_CHUNK_SIZE = 200;
const POLLING_INTERVAL_MS = 4000;
const TRANSLATION_QUERY_BATCH_SIZE = 10;

function compactObject<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function sanitizeJsonValue<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeJsonValue(entry)) as T;
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, entryValue]) => entryValue !== undefined)
                .map(([entryKey, entryValue]) => [entryKey, sanitizeJsonValue(entryValue)]),
        ) as T;
    }

    return value;
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
            .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`);

        return `{${entries.join(',')}}`;
    }

    return JSON.stringify(value);
}

function serializeSlideItem(item: SlideItem) {
    return compactObject({
        id: item.id,
        ref: item.ref,
        text: item.text,
        segments: item.segments?.map((segment) => ({
            verseNumber: segment.verseNumber,
            text: segment.text,
        })),
        translationShortName: item.translationShortName,
    });
}

function deserializeSlideItem(item: Partial<SlideItem>) {
    return {
        id: item.id ?? '',
        ref: item.ref ?? '',
        text: item.text ?? '',
        segments: Array.isArray(item.segments)
            ? item.segments
                .filter((segment): segment is NonNullable<SlideItem['segments']>[number] => Boolean(segment) && typeof segment.verseNumber === 'number' && typeof segment.text === 'string')
                .map((segment) => ({ verseNumber: segment.verseNumber, text: segment.text }))
            : undefined,
        translationShortName: typeof item.translationShortName === 'string' ? item.translationShortName : undefined,
    } satisfies SlideItem;
}

function chunkArray<T>(values: T[], chunkSize: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < values.length; index += chunkSize) {
        chunks.push(values.slice(index, index + chunkSize));
    }

    return chunks;
}

function mergeSettings(settingsData: Partial<AppSettings> | undefined) {
    return {
        activeTranslationId: typeof settingsData?.activeTranslationId === 'string' ? settingsData.activeTranslationId : null,
        selectedResourceTab: settingsData?.selectedResourceTab ?? defaultAppSettings.selectedResourceTab,
        defaultThemeId: typeof settingsData?.defaultThemeId === 'string' ? settingsData.defaultThemeId : null,
        projectorBackground: settingsData?.projectorBackground ?? defaultAppSettings.projectorBackground,
        showVerseNumbers: typeof settingsData?.showVerseNumbers === 'boolean' ? settingsData.showVerseNumbers : defaultAppSettings.showVerseNumbers,
    } satisfies AppSettings;
}

function expectNoSupabaseError(error: { message: string } | null, fallbackMessage: string) {
    if (error) {
        throw new Error(error.message || fallbackMessage);
    }
}

async function loadTranslationMetadata(uid: string, options?: LoadStoredTranslationsOptions) {
    let query = supabase
        .from(TRANSLATIONS_TABLE)
        .select('translation_id,name,short_name,source_file_name,updated_at')
        .eq('user_id', uid)
        .order('translation_id', { ascending: true });

    if (options?.translationIds?.length) {
        query = query.in('translation_id', options.translationIds);
    }

    const { data, error } = await query;

    expectNoSupabaseError(error, 'Unable to load translation metadata.');
    return (data ?? []) as TranslationRow[];
}

async function loadTranslationChunkRows(uid: string, translationIds: string[]) {
    if (translationIds.length === 0) {
        return [] as TranslationChunkRow[];
    }

    const chunkRows: TranslationChunkRow[] = [];

    for (let index = 0; index < translationIds.length; index += TRANSLATION_QUERY_BATCH_SIZE) {
        const batchIds = translationIds.slice(index, index + TRANSLATION_QUERY_BATCH_SIZE);
        const { data, error } = await supabase
            .from(TRANSLATION_CHUNKS_TABLE)
            .select('translation_id,chunk_index,verses')
            .eq('user_id', uid)
            .in('translation_id', batchIds)
            .order('translation_id', { ascending: true })
            .order('chunk_index', { ascending: true });

        expectNoSupabaseError(error, 'Unable to load translation chunks.');
        chunkRows.push(...((data ?? []) as TranslationChunkRow[]));
    }

    return chunkRows;
}

async function saveWorkspaceDocument(uid: string, documentId: string, payload: unknown) {
    const { error } = await supabase
        .from(WORKSPACE_TABLE)
        .upsert({
            user_id: uid,
            document_id: documentId,
            payload: sanitizeJsonValue(payload),
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'user_id,document_id',
        });

    expectNoSupabaseError(error, `Unable to save workspace document ${documentId}.`);
}

async function loadWorkspaceDocuments(uid: string) {
    const { data, error } = await supabase
        .from(WORKSPACE_TABLE)
        .select('document_id,payload')
        .eq('user_id', uid);

    expectNoSupabaseError(error, 'Unable to load workspace documents.');
    return new Map((data ?? []).map((row) => [String((row as WorkspaceDocumentRow).document_id), (row as WorkspaceDocumentRow).payload]));
}

export async function loadUserWorkspace(uid: string): Promise<UserWorkspace> {
    const documents = await loadWorkspaceDocuments(uid);
    const settingsData = documents.get('settings') as Partial<AppSettings> | undefined;
    const sessionItems = Array.isArray(documents.get('presentations')) ? documents.get('presentations') as Partial<SlideItem>[] : [];
    const songsPayload = documents.get('songs');
    const songs = Array.isArray(songsPayload)
        ? songsPayload as SongItem[]
        : songsPayload && typeof songsPayload === 'object' && Array.isArray((songsPayload as { songs?: unknown }).songs)
            ? (songsPayload as { songs: SongItem[] }).songs
            : [];
    const songCategories = songsPayload && typeof songsPayload === 'object' && Array.isArray((songsPayload as { categories?: unknown }).categories)
        ? (songsPayload as { categories: SongCategory[] }).categories
        : [];
    const mediaItems = Array.isArray(documents.get('media')) ? documents.get('media') as MediaItem[] : [];
    const themes = Array.isArray(documents.get('themes')) ? documents.get('themes') as ThemeItem[] : [];
    const presentations = Array.isArray(documents.get('presentation-library')) ? documents.get('presentation-library') as PresentationItem[] : [];

    return {
        sessionItems: sessionItems.map((item) => deserializeSlideItem(item)),
        songCategories,
        songs,
        mediaItems,
        themes,
        presentations,
        settings: mergeSettings(settingsData),
    } satisfies UserWorkspace;
}

export async function saveUserSettings(uid: string, settings: AppSettings) {
    await saveWorkspaceDocument(uid, 'settings', settings);
}

export async function saveSessionItems(uid: string, sessionItems: SlideItem[]) {
    await saveWorkspaceDocument(uid, 'presentations', sessionItems.map((item) => serializeSlideItem(item)));
}

export async function clearSessionItems(uid: string) {
    await saveSessionItems(uid, []);
}

export function clearSessionItemsWithKeepalive(uid: string) {
    const accessToken = getSupabaseAccessToken();
    if (!accessToken) {
        return;
    }

    void fetch(`${supabaseUrl}/rest/v1/${WORKSPACE_TABLE}?on_conflict=user_id,document_id`, {
        method: 'POST',
        headers: {
            apikey: supabasePublishableKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
            user_id: uid,
            document_id: 'presentations',
            payload: [],
            updated_at: new Date().toISOString(),
        }),
        keepalive: true,
    }).catch(() => {
        // Best-effort only during page shutdown.
    });
}

export async function saveSongs(uid: string, songs: SongItem[], categories: SongCategory[] = []) {
    await saveWorkspaceDocument(uid, 'songs', {
        songs: songs.map((song) => ({ ...song })),
        categories: categories.map((category) => ({ ...category })),
    });
}

export async function saveMediaItems(uid: string, mediaItems: MediaItem[]) {
    await saveWorkspaceDocument(uid, 'media', mediaItems.map((item) => ({ ...item })));
}

export async function saveThemes(uid: string, themes: ThemeItem[]) {
    await saveWorkspaceDocument(uid, 'themes', themes.map((theme) => ({ ...theme })));
}

export async function savePresentations(uid: string, presentations: PresentationItem[]) {
    await saveWorkspaceDocument(uid, 'presentation-library', presentations.map((presentation) => ({ ...presentation })));
}

function createPollingSubscription<T>(
    loadData: () => Promise<T>,
    onData: (value: T) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    let disposed = false;
    let lastSignature = '';

    const poll = async () => {
        try {
            const value = await loadData();
            if (disposed) {
                return;
            }

            const nextSignature = stableStringify(value);
            if (nextSignature !== lastSignature) {
                lastSignature = nextSignature;
                onData(value);
            }
        } catch (error) {
            if (!disposed) {
                onError?.(error instanceof Error ? error : new Error('Unable to refresh Supabase data.'));
            }
        }
    };

    void poll();
    const interval = window.setInterval(() => {
        void poll();
    }, POLLING_INTERVAL_MS);

    return () => {
        disposed = true;
        window.clearInterval(interval);
    };
}

export function subscribeToUserWorkspace(
    uid: string,
    onData: (workspace: UserWorkspace) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    return createPollingSubscription(() => loadUserWorkspace(uid), onData, onError);
}

async function deleteRemovedTranslations(uid: string, nextIds: Set<string>) {
    const { data, error } = await supabase
        .from(TRANSLATIONS_TABLE)
        .select('translation_id')
        .eq('user_id', uid);

    expectNoSupabaseError(error, 'Unable to inspect existing translations.');

    const idsToDelete = (data ?? [])
        .map((row) => String((row as Pick<TranslationRow, 'translation_id'>).translation_id))
        .filter((translationId) => !nextIds.has(translationId));

    if (idsToDelete.length === 0) {
        return;
    }

    const { error: chunksError } = await supabase
        .from(TRANSLATION_CHUNKS_TABLE)
        .delete()
        .eq('user_id', uid)
        .in('translation_id', idsToDelete);

    expectNoSupabaseError(chunksError, 'Unable to remove deleted translation chunks.');

    const { error: translationsError } = await supabase
        .from(TRANSLATIONS_TABLE)
        .delete()
        .eq('user_id', uid)
        .in('translation_id', idsToDelete);

    expectNoSupabaseError(translationsError, 'Unable to remove deleted translations.');
}

export async function loadStoredTranslations(uid: string, options?: LoadStoredTranslationsOptions): Promise<BibleTranslation[]> {
    const translationRows = await loadTranslationMetadata(uid, options);
    const includeVerses = options?.includeVerses ?? true;
    const chunkRows = includeVerses
        ? await loadTranslationChunkRows(uid, translationRows.map((row) => row.translation_id))
        : [];

    const chunksByTranslation = new Map<string, Partial<SlideItem>[]>();

    for (const row of chunkRows) {
        const currentItems = chunksByTranslation.get(row.translation_id) ?? [];
        const verses = Array.isArray(row.verses) ? row.verses as Partial<SlideItem>[] : [];
        currentItems.push(...verses);
        chunksByTranslation.set(row.translation_id, currentItems);
    }

    return translationRows.map((row) => sanitizeTranslation({
        id: row.translation_id,
        name: row.name,
        shortName: row.short_name,
        sourceFileName: row.source_file_name ?? undefined,
        verses: includeVerses
            ? (chunksByTranslation.get(row.translation_id) ?? []).map((item) => deserializeSlideItem(item))
            : [],
    } satisfies BibleTranslation));
}

export async function saveStoredTranslations(uid: string, translations: BibleTranslation[]): Promise<void> {
    const nextIds = new Set(translations.map((translation) => translation.id));
    await deleteRemovedTranslations(uid, nextIds);

    for (const translation of translations) {
        const { error: translationError } = await supabase
            .from(TRANSLATIONS_TABLE)
            .upsert({
                user_id: uid,
                translation_id: translation.id,
                name: translation.name,
                short_name: translation.shortName,
                source_file_name: translation.sourceFileName ?? null,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'user_id,translation_id',
            });

        expectNoSupabaseError(translationError, `Unable to save translation ${translation.id}.`);

        const { error: deleteChunksError } = await supabase
            .from(TRANSLATION_CHUNKS_TABLE)
            .delete()
            .eq('user_id', uid)
            .eq('translation_id', translation.id);

        expectNoSupabaseError(deleteChunksError, `Unable to refresh translation chunks for ${translation.id}.`);

        const chunkRows = chunkArray(translation.verses.map((verse) => serializeSlideItem(verse)), VERSE_CHUNK_SIZE).map((verses, index) => ({
            user_id: uid,
            translation_id: translation.id,
            chunk_index: index,
            verses,
            updated_at: new Date().toISOString(),
        }));

        if (chunkRows.length > 0) {
            const { error: insertChunksError } = await supabase
                .from(TRANSLATION_CHUNKS_TABLE)
                .insert(chunkRows);

            expectNoSupabaseError(insertChunksError, `Unable to save translation chunks for ${translation.id}.`);
        }
    }
}

export function subscribeToStoredTranslations(
    uid: string,
    onData: (translations: BibleTranslation[]) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    let disposed = false;
    let lastMetadataSignature = '';

    const poll = async () => {
        try {
            const translationRows = await loadTranslationMetadata(uid);
            if (disposed) {
                return;
            }

            const nextMetadataSignature = stableStringify(
                translationRows.map((row) => ({
                    id: row.translation_id,
                    updatedAt: row.updated_at,
                })),
            );

            if (nextMetadataSignature === lastMetadataSignature) {
                return;
            }

            lastMetadataSignature = nextMetadataSignature;
            onData(await loadStoredTranslations(uid, { includeVerses: false }));
        } catch (error) {
            if (!disposed) {
                onError?.(error instanceof Error ? error : new Error('Unable to refresh Supabase data.'));
            }
        }
    };

    void poll();
    const interval = window.setInterval(() => {
        void poll();
    }, POLLING_INTERVAL_MS);

    return () => {
        disposed = true;
        window.clearInterval(interval);
    };
}
