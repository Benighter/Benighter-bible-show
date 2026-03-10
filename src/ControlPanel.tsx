import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { createProjectorPresenceListener, createSender, type PresentationState, type VerseSegment } from './lib/Broadcast';
import { canonicalizeBookName, parseBibleTranslationFile, sanitizeTranslation, serializeBibleTranslation, type BibleTranslation, type SlideItem } from './lib/BibleTranslations';
import { defaultAppSettings, type AppSettings, type MediaItem, type PresentationItem, type ResourceTab, type SongItem, type ThemeItem } from './lib/AppData';
import { loadStoredTranslations as loadCloudTranslations, loadUserWorkspace, saveMediaItems, savePresentations, saveSessionItems, saveSongs, saveStoredTranslations as saveCloudTranslations, saveThemes, saveUserSettings, subscribeToStoredTranslations, subscribeToUserWorkspace } from './lib/FirebaseWorkspaceStorage';
import { useAuth } from './lib/auth-context';
import { ResizablePanelGroup } from './lib/ResizablePanelGroup';
import { Play, Square, MonitorPlay, ListPlus, XCircle, FilePlus, FolderOpen, Save, Store, Globe, Bell, Image, CircleStop, ChevronRight, ChevronDown, LogOut, Trash2 } from 'lucide-react';
import './index.css';

interface ManagedScreen {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    availLeft: number;
    availTop: number;
    availWidth: number;
    availHeight: number;
}

interface ManagedScreenDetails {
    currentScreen: ManagedScreen;
    screens: ManagedScreen[];
}

type WindowWithScreenDetails = Window & {
    getScreenDetails?: () => Promise<ManagedScreenDetails>;
};

const SCRIPTURE_TABLE_LIMIT = 250;
const RESOURCE_TABS: ResourceTab[] = ['Songs', 'Scriptures', 'Media', 'Presentations', 'Themes', 'Settings'];
const TRANSLATION_CACHE_PREFIX = 'bible-show-translation-cache';
const TRANSLATION_CACHE_INDEX_LIMIT = 4;

type ScriptureSearchMatch = {
    results: SlideItem[];
    targetVerse: SlideItem | null;
    targetRange: SlideItem[] | null;
    rangeReference: string | null;
    chapterLabel: string | null;
};

type BookOption = {
    book: string;
    chapters: number[];
};

function normalizeReferenceText(value: string) {
    return value
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseVerseReference(ref: string) {
    const match = ref.match(/^(.*)\s+(\d+):(\d+)$/);
    if (!match) {
        return null;
    }

    return {
        book: match[1],
        bookNormalized: normalizeReferenceText(match[1]),
        chapter: Number.parseInt(match[2], 10),
        verse: Number.parseInt(match[3], 10),
    };
}

function buildRangeSlideItem(items: SlideItem[]): SlideItem | null {
    if (items.length === 0) {
        return null;
    }

    const firstRef = parseVerseReference(items[0].ref);
    const lastRef = parseVerseReference(items[items.length - 1].ref);
    if (!firstRef || !lastRef) {
        return null;
    }

    const rangeReference = `${firstRef.book} ${firstRef.chapter}:${firstRef.verse}-${lastRef.verse}`;
    const segments: VerseSegment[] = items
        .map((item) => {
            const parsedRef = parseVerseReference(item.ref);
            if (!parsedRef) {
                return null;
            }

            return {
                verseNumber: parsedRef.verse,
                text: item.text,
            } satisfies VerseSegment;
        })
        .filter((segment): segment is VerseSegment => segment !== null);

    return {
        id: `${items[0].id}-range-${lastRef.verse}`,
        ref: rangeReference,
        text: segments.map((segment) => `${segment.verseNumber}. ${segment.text}`).join(' '),
        segments,
        translationShortName: items[0].translationShortName,
    };
}

function formatSlideReference(item: SlideItem) {
    return item.translationShortName ? `${item.ref} (${item.translationShortName})` : item.ref;
}

function buildTranslationVerseItems(translation: BibleTranslation) {
    return translation.verses.map((verse) => ({
        ...verse,
        translationShortName: verse.translationShortName ?? translation.shortName,
    }));
}

function findMatchingProjectedItem(reference: string, verses: SlideItem[]) {
    const scriptureMatch = findScriptureMatches(reference, verses);
    if (!scriptureMatch) {
        return null;
    }

    if (scriptureMatch.targetRange) {
        return buildRangeSlideItem(scriptureMatch.targetRange) ?? null;
    }

    return scriptureMatch.targetVerse ?? scriptureMatch.results[0] ?? null;
}

function getDefaultTranslationId(translations: BibleTranslation[]) {
    const preferredTranslation = translations.find((translation) => {
        const shortName = translation.shortName.trim().toLowerCase();
        const name = translation.name.trim().toLowerCase();

        return shortName === 'kjv' || shortName.startsWith('kjv') || name.includes('king james');
    });

    return preferredTranslation?.id ?? translations[0]?.id ?? null;
}

function buildVisibleScriptureRows(items: SlideItem[], focusedItem: SlideItem | null, limit: number) {
    const initialRows = items.slice(0, limit);
    if (!focusedItem) {
        return initialRows;
    }

    const focusedItemIndex = items.findIndex((item) => item.id === focusedItem.id);
    if (focusedItemIndex === -1) {
        return initialRows;
    }

    const rowsBeforeFocusedItem = Math.min(4, focusedItemIndex);
    const startIndex = Math.max(focusedItemIndex - rowsBeforeFocusedItem, 0);
    const nextRows = items.slice(startIndex, startIndex + limit);

    if (nextRows.length >= limit || startIndex === 0) {
        return nextRows;
    }

    return items.slice(Math.max(items.length - limit, 0));
}

function findScriptureMatches(query: string, verses: SlideItem[]): ScriptureSearchMatch | null {
    const normalizedQuery = normalizeReferenceText(query);
    if (!normalizedQuery) {
        return null;
    }

    const referenceMatch = normalizedQuery.match(/^(.+?)\s+(\d+)(?:(?::|\s+)(\d+)(?:\s*-\s*(\d+))?)?$/);
    if (referenceMatch) {
        const bookQuery = normalizeReferenceText(canonicalizeBookName(referenceMatch[1]));
        const chapter = Number.parseInt(referenceMatch[2], 10);
        const verse = referenceMatch[3] ? Number.parseInt(referenceMatch[3], 10) : null;
        const endVerse = referenceMatch[4] ? Number.parseInt(referenceMatch[4], 10) : null;

        const chapterResults = verses.filter((item) => {
            const parsedRef = parseVerseReference(item.ref);
            return parsedRef?.bookNormalized === bookQuery && parsedRef.chapter === chapter;
        });

        if (chapterResults.length > 0) {
            const rangeResults = verse != null && endVerse != null
                ? chapterResults.filter((item) => {
                    const parsedRef = parseVerseReference(item.ref);
                    return parsedRef != null && parsedRef.verse >= verse && parsedRef.verse <= endVerse;
                })
                : null;

            return {
                results: rangeResults && rangeResults.length > 0 ? rangeResults : chapterResults,
                targetVerse: verse == null
                    ? null
                    : chapterResults.find((item) => parseVerseReference(item.ref)?.verse === verse) ?? null,
                targetRange: rangeResults && rangeResults.length > 0 ? rangeResults : null,
                rangeReference: rangeResults && rangeResults.length > 0 ? buildRangeSlideItem(rangeResults)?.ref ?? null : null,
                chapterLabel: chapterResults[0].ref.split(':')[0],
            };
        }
    }

    const textResults = verses.filter((item) => `${item.ref} ${item.text}`.toLowerCase().includes(normalizedQuery));
    if (textResults.length === 0) {
        return null;
    }

    return {
        results: textResults,
        targetVerse: null,
        targetRange: null,
        rangeReference: null,
        chapterLabel: null,
    };
}

function buildBookOptions(verses: SlideItem[]): BookOption[] {
    const chaptersByBook = new Map<string, Set<number>>();

    for (const verse of verses) {
        const parsedRef = parseVerseReference(verse.ref);
        if (!parsedRef) {
            continue;
        }

        if (!chaptersByBook.has(parsedRef.book)) {
            chaptersByBook.set(parsedRef.book, new Set<number>());
        }

        chaptersByBook.get(parsedRef.book)?.add(parsedRef.chapter);
    }

    return Array.from(chaptersByBook.entries()).map(([book, chapters]) => ({
        book,
        chapters: Array.from(chapters).sort((left, right) => left - right),
    }));
}

function createEntityId(prefix: string) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function matchesResourceSearch(values: string[], query: string) {
    if (!query) {
        return true;
    }

    return values.some((value) => value.toLowerCase().includes(query));
}

function buildStableSignature(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => buildStableSignature(entry)).join(',')}]`;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
            .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${buildStableSignature(entryValue)}`);

        return `{${entries.join(',')}}`;
    }

    return JSON.stringify(value);
}

function buildSettingsPayload(settings: AppSettings, activeTranslationId: string | null, selectedResourceTab: ResourceTab) {
    return {
        ...settings,
        activeTranslationId,
        selectedResourceTab,
    } satisfies AppSettings;
}

function buildTranslationCacheKey(userId: string, translationId: string) {
    return `${TRANSLATION_CACHE_PREFIX}:${userId}:${translationId}`;
}

function buildTranslationCacheIndexKey(userId: string) {
    return `${TRANSLATION_CACHE_PREFIX}:${userId}:index`;
}

function readCachedTranslation(userId: string, translationId: string) {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const rawValue = window.localStorage.getItem(buildTranslationCacheKey(userId, translationId));
        if (!rawValue) {
            return null;
        }

        const parsedValue = JSON.parse(rawValue) as Partial<BibleTranslation> | null;
        if (!parsedValue || typeof parsedValue.id !== 'string' || typeof parsedValue.name !== 'string' || typeof parsedValue.shortName !== 'string' || !Array.isArray(parsedValue.verses)) {
            return null;
        }

        return sanitizeTranslation({
            id: parsedValue.id,
            name: parsedValue.name,
            shortName: parsedValue.shortName,
            verses: parsedValue.verses,
            sourceFileName: typeof parsedValue.sourceFileName === 'string' ? parsedValue.sourceFileName : undefined,
        });
    } catch {
        return null;
    }
}

function writeCachedTranslation(userId: string, translation: BibleTranslation) {
    if (typeof window === 'undefined' || translation.verses.length === 0) {
        return;
    }

    try {
        const indexKey = buildTranslationCacheIndexKey(userId);
        const currentIndex = JSON.parse(window.localStorage.getItem(indexKey) ?? '[]') as string[];
        const nextIndex = [translation.id, ...currentIndex.filter((cachedId) => cachedId !== translation.id)].slice(0, TRANSLATION_CACHE_INDEX_LIMIT);

        window.localStorage.setItem(buildTranslationCacheKey(userId, translation.id), JSON.stringify(translation));
        window.localStorage.setItem(indexKey, JSON.stringify(nextIndex));

        for (const cachedId of currentIndex) {
            if (!nextIndex.includes(cachedId)) {
                window.localStorage.removeItem(buildTranslationCacheKey(userId, cachedId));
            }
        }
    } catch {
        // Ignore cache write failures and fall back to network loading.
    }
}

function isQuotaExceededError(error: unknown) {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';

    return code.includes('resource-exhausted') || message.toLowerCase().includes('quota exceeded');
}

function buildSongSlideItem(song: SongItem): SlideItem {
    return {
        id: `song-slide-${song.id}`,
        ref: song.title,
        text: song.lyrics || song.notes || song.title,
        translationShortName: song.keySignature ? `Song • ${song.keySignature}` : 'Song',
    };
}

function buildPresentationSlideItem(presentation: PresentationItem): SlideItem {
    return {
        id: `presentation-slide-${presentation.id}`,
        ref: presentation.reference.trim() || presentation.title.trim() || 'Presentation',
        text: presentation.content.trim(),
        translationShortName: presentation.category.trim() || 'Presentation',
    };
}

export default function ControlPanel() {
    const { signOutUser, user, resetPassword, updateDisplayName, isAuthenticating } = useAuth();
    const senderRef = useRef<ReturnType<typeof createSender> | null>(null);
    const translationImportRef = useRef<HTMLInputElement | null>(null);
    const translationFolderImportRef = useRef<HTMLInputElement | null>(null);
    const lastSubmittedSearchRef = useRef('');
    const cloudHydratedRef = useRef(false);
    const writesPausedRef = useRef(false);
    const syncedPayloadSignaturesRef = useRef({
        sessionItems: '',
        translations: '',
        settings: '',
        songs: '',
        mediaItems: '',
        themes: '',
        presentations: '',
    });
    const dirtyPayloadsRef = useRef({
        sessionItems: false,
        translations: false,
        settings: false,
        songs: false,
        mediaItems: false,
        themes: false,
        presentations: false,
    });
    const loadingTranslationIdsRef = useRef(new Set<string>());
    const translationsRef = useRef<BibleTranslation[]>([]);
    const activeTranslationIdRef = useRef<string | null>(null);
    const userIdRef = useRef<string | null>(null);
    const localPayloadSignaturesRef = useRef({
        sessionItems: '',
        translations: '',
        settings: '',
        songs: '',
        mediaItems: '',
        themes: '',
        presentations: '',
    });

    // Core State
    const [sessionItems, setSessionItems] = useState<SlideItem[]>([]);
    const [songs, setSongs] = useState<SongItem[]>([]);
    const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
    const [themes, setThemes] = useState<ThemeItem[]>([]);
    const [presentations, setPresentations] = useState<PresentationItem[]>([]);
    const [resTab, setResTab] = useState<ResourceTab>('Songs');
    const [searchQuery, setSearchQuery] = useState('');
    const [committedScriptureQuery, setCommittedScriptureQuery] = useState('');
    const [selectedBook, setSelectedBook] = useState('');
    const [selectedChapter, setSelectedChapter] = useState('');
    const [translations, setTranslations] = useState<BibleTranslation[]>([]);
    const [activeTranslationId, setActiveTranslationId] = useState<string | null>(null);
    const [translationStatus, setTranslationStatus] = useState<string | null>(null);
    const [isImportingTranslation, setIsImportingTranslation] = useState(false);
    const [workspaceStatus, setWorkspaceStatus] = useState<string | null>('Connecting...');
    const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
    const [songForm, setSongForm] = useState({ title: '', author: '', copyright: '', lyrics: '', keySignature: '', tags: '', notes: '' });
    const [mediaForm, setMediaForm] = useState({ title: '', type: '', source: '', notes: '', duration: '', thumbnailUrl: '', aspectRatio: '' });
    const [themeForm, setThemeForm] = useState({ name: '', background: '#111111', textColor: '#f5f5f5', accentColor: '#00aba9', fontFamily: 'Segoe UI', textSize: '96', notes: '' });
    const [presentationForm, setPresentationForm] = useState({ title: '', content: '', reference: '', category: 'Announcement', background: '#000000', themeId: '' });
    const [profileForm, setProfileForm] = useState({ displayName: '' });
    const [accountStatus, setAccountStatus] = useState<string | null>(null);
    const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
    const [selectedMediaItemId, setSelectedMediaItemId] = useState<string | null>(null);
    const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
    const [selectedPresentationId, setSelectedPresentationId] = useState<string | null>(null);

    // Monitor State
    const [previewItem, setPreviewItem] = useState<SlideItem | null>(null);
    const [liveItem, setLiveItem] = useState<SlideItem | null>(null);
    const [isLiveOffline, setIsLiveOffline] = useState(true);

    // Projector Connection State
    const projectorWindowRef = useRef<Window | null>(null);
    const secondaryScreenRef = useRef<ManagedScreen | null>(null);
    const projectorHeartbeatTimeoutRef = useRef<number | null>(null);
    const latestPresentationStateRef = useRef<PresentationState>({ type: 'clear', text: '' });
    const isSharingRef = useRef(false);
    const externalProjectorDetectedRef = useRef(false);

    const positionProjectorWindow = useCallback((projectorWindow: Window, screen: ManagedScreen | null) => {
        if (!screen || projectorWindow.closed) {
            return;
        }

        try {
            projectorWindow.moveTo(screen.left ?? screen.availLeft, screen.top ?? screen.availTop);
            projectorWindow.resizeTo(screen.width ?? screen.availWidth, screen.height ?? screen.availHeight);
            projectorWindow.focus();
        } catch (err) {
            console.warn('Unable to position projector window on the secondary display.', err);
        }
    }, []);

    const setSharingState = (nextValue: boolean) => {
        isSharingRef.current = nextValue;
    };

    const setProjectorDetectedState = (nextValue: boolean) => {
        externalProjectorDetectedRef.current = nextValue;
    };

    const clearProjectorHeartbeatTimeout = useCallback(() => {
        if (projectorHeartbeatTimeoutRef.current) {
            window.clearTimeout(projectorHeartbeatTimeoutRef.current);
            projectorHeartbeatTimeoutRef.current = null;
        }
    }, []);

    const sendPresentationState = (state: PresentationState) => {
        latestPresentationStateRef.current = state;
        senderRef.current?.send(state);
    };

    const getSecondaryScreen = async () => {
        const managedWindow = window as WindowWithScreenDetails;
        if (!managedWindow.getScreenDetails) {
            return null;
        }

        if ('permissions' in navigator) {
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'window-management' as PermissionName });
                if (permissionStatus.state === 'denied') {
                    return null;
                }
            } catch (err) {
                console.warn('Unable to query window-management permission.', err);
            }
        }

        try {
            const screenDetails = await managedWindow.getScreenDetails();
            const secondaryScreens = screenDetails.screens.filter((screen) => screen !== screenDetails.currentScreen);

            if (secondaryScreens.length === 0) {
                return null;
            }

            return secondaryScreens.sort((left, right) => {
                const leftArea = (left.width ?? left.availWidth) * (left.height ?? left.availHeight);
                const rightArea = (right.width ?? right.availWidth) * (right.height ?? right.availHeight);
                return rightArea - leftArea;
            })[0];
        } catch (err) {
            console.warn('Unable to get secondary screen details.', err);
            return null;
        }
    };

    const handleProjectorClosed = useCallback(() => {
        projectorWindowRef.current = null;
        setProjectorDetectedState(false);
        clearProjectorHeartbeatTimeout();
        setSharingState(false);
        setIsLiveOffline(true);
        setLiveItem(null);
    }, [clearProjectorHeartbeatTimeout]);

    const activeTranslation = translations.find((translation) => translation.id === activeTranslationId) ?? translations[0] ?? undefined;
    const sortedTranslations = useMemo(
        () => [...translations].sort((left, right) => {
            const shortNameCompare = left.shortName.localeCompare(right.shortName, undefined, { sensitivity: 'base' });
            if (shortNameCompare !== 0) {
                return shortNameCompare;
            }

            return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        }),
        [translations],
    );
    const scriptureItems = useMemo(
        () => activeTranslation ? buildTranslationVerseItems(activeTranslation) : [],
        [activeTranslation],
    );
    const bookOptions = useMemo(() => buildBookOptions(scriptureItems), [scriptureItems]);
    const chapterOptions = useMemo(
        () => bookOptions.find((option) => option.book === selectedBook)?.chapters ?? [],
        [bookOptions, selectedBook],
    );
    const scriptureSearchMatch = useMemo(
        () => findScriptureMatches(committedScriptureQuery, scriptureItems),
        [committedScriptureQuery, scriptureItems],
    );
    const filteredScriptureItems = useMemo(
        () => scriptureSearchMatch?.results ?? [],
        [scriptureSearchMatch],
    );
    const highlightedScriptureItem = useMemo(() => {
        if (scriptureSearchMatch?.targetVerse && filteredScriptureItems.some((item) => item.id === scriptureSearchMatch.targetVerse?.id)) {
            return scriptureSearchMatch.targetVerse;
        }

        if (scriptureSearchMatch?.targetRange?.[0] && filteredScriptureItems.some((item) => item.id === scriptureSearchMatch.targetRange?.[0]?.id)) {
            return scriptureSearchMatch.targetRange[0];
        }

        if (liveItem && filteredScriptureItems.some((item) => item.id === liveItem.id)) {
            return liveItem;
        }

        if (previewItem && filteredScriptureItems.some((item) => item.id === previewItem.id)) {
            return previewItem;
        }

        return null;
    }, [filteredScriptureItems, liveItem, previewItem, scriptureSearchMatch]);

    const visibleScriptureRows = useMemo(
        () => buildVisibleScriptureRows(filteredScriptureItems, highlightedScriptureItem, SCRIPTURE_TABLE_LIMIT),
        [filteredScriptureItems, highlightedScriptureItem],
    );

    const hiddenScriptureRowCount = Math.max(filteredScriptureItems.length - visibleScriptureRows.length, 0);
    const sessionItemIds = useMemo(() => new Set(sessionItems.map((item) => item.id)), [sessionItems]);
    const normalizedResourceSearch = searchQuery.trim().toLowerCase();
    const filteredSongs = useMemo(
        () => songs.filter((song) => matchesResourceSearch([song.title, song.author, song.copyright, song.lyrics], normalizedResourceSearch)),
        [normalizedResourceSearch, songs],
    );
    const filteredMediaItems = useMemo(
        () => mediaItems.filter((item) => matchesResourceSearch([item.title, item.type, item.source, item.notes], normalizedResourceSearch)),
        [mediaItems, normalizedResourceSearch],
    );
    const filteredPresentationItems = useMemo(
        () => presentations.filter((item) => matchesResourceSearch([item.title, item.content, item.reference, item.category], normalizedResourceSearch)),
        [normalizedResourceSearch, presentations],
    );
    const filteredThemes = useMemo(
        () => themes.filter((theme) => matchesResourceSearch([theme.name, theme.background, theme.textColor, theme.accentColor], normalizedResourceSearch)),
        [normalizedResourceSearch, themes],
    );
    const activeTheme = themes.find((theme) => theme.id === appSettings.defaultThemeId) ?? null;
    const selectedSong = songs.find((song) => song.id === selectedSongId) ?? null;
    const selectedMediaItem = mediaItems.find((item) => item.id === selectedMediaItemId) ?? null;
    const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) ?? null;
    const selectedPresentation = presentations.find((presentation) => presentation.id === selectedPresentationId) ?? null;

    useEffect(() => {
        translationsRef.current = translations;
        activeTranslationIdRef.current = activeTranslationId;
        userIdRef.current = user?.uid ?? null;
        localPayloadSignaturesRef.current = {
            sessionItems: buildStableSignature(sessionItems),
            translations: buildStableSignature(translations),
            settings: buildStableSignature(buildSettingsPayload(appSettings, activeTranslationId, resTab)),
            songs: buildStableSignature(songs),
            mediaItems: buildStableSignature(mediaItems),
            themes: buildStableSignature(themes),
            presentations: buildStableSignature(presentations),
        };
    }, [activeTranslationId, appSettings, mediaItems, presentations, resTab, sessionItems, songs, themes, translations, user?.uid]);

    const applyWorkspaceData = useCallback((workspace: Awaited<ReturnType<typeof loadUserWorkspace>>) => {
        const nextSettings = {
            ...defaultAppSettings,
            ...workspace.settings,
        } satisfies AppSettings;

        const nextSessionItemsSignature = buildStableSignature(workspace.sessionItems);
        const nextSongsSignature = buildStableSignature(workspace.songs);
        const nextMediaItemsSignature = buildStableSignature(workspace.mediaItems);
        const nextThemesSignature = buildStableSignature(workspace.themes);
        const nextPresentationsSignature = buildStableSignature(workspace.presentations);
        const nextSettingsSignature = buildStableSignature(
            buildSettingsPayload(
                nextSettings,
                nextSettings.activeTranslationId ?? null,
                RESOURCE_TABS.includes(nextSettings.selectedResourceTab) ? nextSettings.selectedResourceTab : defaultAppSettings.selectedResourceTab,
            ),
        );

        if (!dirtyPayloadsRef.current.sessionItems || nextSessionItemsSignature === localPayloadSignaturesRef.current.sessionItems) {
            syncedPayloadSignaturesRef.current.sessionItems = nextSessionItemsSignature;
            dirtyPayloadsRef.current.sessionItems = false;
            setSessionItems(workspace.sessionItems);
        }

        if (!dirtyPayloadsRef.current.songs || nextSongsSignature === localPayloadSignaturesRef.current.songs) {
            syncedPayloadSignaturesRef.current.songs = nextSongsSignature;
            dirtyPayloadsRef.current.songs = false;
            setSongs(workspace.songs);
        }

        if (!dirtyPayloadsRef.current.mediaItems || nextMediaItemsSignature === localPayloadSignaturesRef.current.mediaItems) {
            syncedPayloadSignaturesRef.current.mediaItems = nextMediaItemsSignature;
            dirtyPayloadsRef.current.mediaItems = false;
            setMediaItems(workspace.mediaItems);
        }

        if (!dirtyPayloadsRef.current.themes || nextThemesSignature === localPayloadSignaturesRef.current.themes) {
            syncedPayloadSignaturesRef.current.themes = nextThemesSignature;
            dirtyPayloadsRef.current.themes = false;
            setThemes(workspace.themes);
        }

        if (!dirtyPayloadsRef.current.presentations || nextPresentationsSignature === localPayloadSignaturesRef.current.presentations) {
            syncedPayloadSignaturesRef.current.presentations = nextPresentationsSignature;
            dirtyPayloadsRef.current.presentations = false;
            setPresentations(workspace.presentations);
        }

        if (!dirtyPayloadsRef.current.settings || nextSettingsSignature === localPayloadSignaturesRef.current.settings) {
            syncedPayloadSignaturesRef.current.settings = nextSettingsSignature;
            dirtyPayloadsRef.current.settings = false;
            setAppSettings(nextSettings);
            setResTab(RESOURCE_TABS.includes(nextSettings.selectedResourceTab) ? nextSettings.selectedResourceTab : defaultAppSettings.selectedResourceTab);
        }
    }, []);

    const applyTranslationsData = useCallback((storedTranslations: BibleTranslation[], nextActiveTranslationId: string | null = null) => {
        const nextTranslationsSignature = buildStableSignature(storedTranslations);
        if (dirtyPayloadsRef.current.translations && nextTranslationsSignature !== localPayloadSignaturesRef.current.translations) {
            return;
        }

        syncedPayloadSignaturesRef.current.translations = nextTranslationsSignature;
        dirtyPayloadsRef.current.translations = false;
        setTranslations((currentTranslations) => {
            const currentTranslationsById = new Map(currentTranslations.map((translation) => [translation.id, translation]));

            return storedTranslations.map((translation) => {
                if (translation.verses.length > 0) {
                    return translation;
                }

                const currentTranslation = currentTranslationsById.get(translation.id);
                return currentTranslation && currentTranslation.verses.length > 0
                    ? {
                        ...translation,
                        verses: currentTranslation.verses,
                    }
                    : translation;
            });
        });
        setTranslationStatus(storedTranslations.length === 0 ? 'Import a .bib Bible translation to add it to your cloud library.' : null);

        const resolvedActiveTranslationId = nextActiveTranslationId && storedTranslations.some((translation) => translation.id === nextActiveTranslationId)
            ? nextActiveTranslationId
            : getDefaultTranslationId(storedTranslations);
        setActiveTranslationId(resolvedActiveTranslationId);
    }, []);

    const ensureTranslationLoaded = useCallback(async (translationId: string | null) => {
        const userId = userIdRef.current;
        if (!userId || !translationId) {
            return null;
        }

        const existingTranslation = translationsRef.current.find((translation) => translation.id === translationId);
        if (!existingTranslation) {
            return null;
        }

        if (existingTranslation.verses.length > 0) {
            return existingTranslation;
        }

        const cachedTranslation = readCachedTranslation(userId, translationId);
        if (cachedTranslation) {
            setTranslations((currentTranslations) => currentTranslations.map((translation) => (
                translation.id === translationId
                    ? cachedTranslation
                    : translation
            )));
            return cachedTranslation;
        }

        if (loadingTranslationIdsRef.current.has(translationId)) {
            return null;
        }

        loadingTranslationIdsRef.current.add(translationId);

        try {
            const [loadedTranslation] = await loadCloudTranslations(userId, { translationIds: [translationId] });
            if (!loadedTranslation) {
                return null;
            }

            writeCachedTranslation(userId, loadedTranslation);

            setTranslations((currentTranslations) => currentTranslations.map((translation) => (
                translation.id === translationId
                    ? loadedTranslation
                    : translation
            )));

            return loadedTranslation;
        } catch (error) {
            console.warn('Unable to load the selected Bible translation.', error);
            setTranslationStatus('We could not load that Bible translation right now. Please try again.');
            return null;
        } finally {
            loadingTranslationIdsRef.current.delete(translationId);
        }
    }, []);

    useEffect(() => {
        if (!user) {
            cloudHydratedRef.current = false;
            writesPausedRef.current = false;
            syncedPayloadSignaturesRef.current = {
                sessionItems: '',
                translations: '',
                settings: '',
                songs: '',
                mediaItems: '',
                themes: '',
                presentations: '',
            };
            dirtyPayloadsRef.current = {
                sessionItems: false,
                translations: false,
                settings: false,
                songs: false,
                mediaItems: false,
                themes: false,
                presentations: false,
            };
            return;
        }

        let workspaceReady = false;
        let translationsReady = false;
        let disposed = false;
        setWorkspaceStatus('Loading your content...');

        const markHydrated = () => {
            if (workspaceReady && translationsReady) {
                cloudHydratedRef.current = true;
            }
        };

        const hydrateFromFetch = async (reason: 'initial' | 'fallback') => {
            try {
                const [workspace, storedTranslations] = await Promise.all([
                    loadUserWorkspace(user.uid),
                    loadCloudTranslations(user.uid, { includeVerses: false }),
                ]);

                if (disposed) {
                    return;
                }

                applyWorkspaceData(workspace);
                applyTranslationsData(storedTranslations, workspace.settings.activeTranslationId ?? null);
                void ensureTranslationLoaded(workspace.settings.activeTranslationId ?? getDefaultTranslationId(storedTranslations));
                workspaceReady = true;
                translationsReady = true;
                markHydrated();
                setWorkspaceStatus(
                        reason === 'fallback'
                        ? 'Your content is ready. Some updates may take a moment to appear.'
                        : 'Your content is ready.',
                    );
            } catch (error) {
                    console.warn('Unable to load the cloud workspace.', error);
                    setWorkspaceStatus('We could not load your content right now. Please try again.');
            }
        };

        void hydrateFromFetch('initial');

        const unsubscribeWorkspace = subscribeToUserWorkspace(user.uid, (workspace) => {
            applyWorkspaceData(workspace);
            workspaceReady = true;
            markHydrated();
        }, (error) => {
            console.warn('Unable to subscribe to the cloud workspace.', error);
            void hydrateFromFetch('fallback');
        });

        const unsubscribeTranslations = subscribeToStoredTranslations(user.uid, (storedTranslations) => {
            applyTranslationsData(storedTranslations, activeTranslationIdRef.current);
            void ensureTranslationLoaded(activeTranslationIdRef.current ?? getDefaultTranslationId(storedTranslations));
            translationsReady = true;
            markHydrated();
        }, (error) => {
            console.warn('Unable to subscribe to Bible translations.', error);
            void hydrateFromFetch('fallback');
        });

        return () => {
            disposed = true;
            unsubscribeWorkspace();
            unsubscribeTranslations();
            cloudHydratedRef.current = false;
        };
    }, [applyTranslationsData, applyWorkspaceData, ensureTranslationLoaded, user]);

    useEffect(() => {
        if (!activeTranslationId) {
            return;
        }

        void ensureTranslationLoaded(activeTranslationId);
    }, [activeTranslationId, ensureTranslationLoaded]);

    useEffect(() => {
        setProfileForm({ displayName: user?.displayName ?? '' });
    }, [user?.displayName]);

    useEffect(() => {
        if (!cloudHydratedRef.current) {
            return;
        }

        const nextActiveTranslationId = appSettings.activeTranslationId && translations.some((translation) => translation.id === appSettings.activeTranslationId)
            ? appSettings.activeTranslationId
            : getDefaultTranslationId(translations);

        if (nextActiveTranslationId !== activeTranslationId) {
            setActiveTranslationId(nextActiveTranslationId);
        }
    }, [activeTranslationId, appSettings.activeTranslationId, translations]);

    const handlePersistenceError = useCallback((error: unknown, defaultMessage: string, statusSetter?: (message: string) => void) => {
        if (isQuotaExceededError(error)) {
            writesPausedRef.current = true;
            const quotaMessage = 'We cannot save changes right now. Please try again a little later.';
            setWorkspaceStatus(quotaMessage);
            statusSetter?.(quotaMessage);
            return;
        }

        setWorkspaceStatus(defaultMessage);
        statusSetter?.(defaultMessage);
    }, []);

    const flushPendingCloudWrites = useCallback(async () => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        const pendingWrites: Promise<void>[] = [];

        if (dirtyPayloadsRef.current.sessionItems) {
            const nextSignature = buildStableSignature(sessionItems);
            if (syncedPayloadSignaturesRef.current.sessionItems === nextSignature) {
                dirtyPayloadsRef.current.sessionItems = false;
            } else {
                pendingWrites.push((async () => {
                    await saveSessionItems(user.uid, sessionItems);
                    syncedPayloadSignaturesRef.current.sessionItems = nextSignature;
                    dirtyPayloadsRef.current.sessionItems = false;
                })().catch((err) => {
                    console.warn('Unable to save schedule items before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your presentation queue. Please try again.');
                    throw err;
                }));
            }
        }

        if (dirtyPayloadsRef.current.translations) {
            const nextSignature = buildStableSignature(translations);
            if (syncedPayloadSignaturesRef.current.translations === nextSignature) {
                dirtyPayloadsRef.current.translations = false;
            } else {
                pendingWrites.push((async () => {
                    await saveCloudTranslations(user.uid, translations);
                    syncedPayloadSignaturesRef.current.translations = nextSignature;
                    dirtyPayloadsRef.current.translations = false;
                })().catch((err) => {
                    console.warn('Unable to save Bible translations before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your Bible translations. Please try again.', setTranslationStatus);
                    throw err;
                }));
            }
        }

        if (dirtyPayloadsRef.current.settings) {
            const nextSettingsPayload = buildSettingsPayload(appSettings, activeTranslationId, resTab);
            const nextSignature = buildStableSignature(nextSettingsPayload);
            if (syncedPayloadSignaturesRef.current.settings === nextSignature) {
                dirtyPayloadsRef.current.settings = false;
            } else {
                pendingWrites.push((async () => {
                    await saveUserSettings(user.uid, nextSettingsPayload);
                    syncedPayloadSignaturesRef.current.settings = nextSignature;
                    dirtyPayloadsRef.current.settings = false;
                })().catch((err) => {
                    console.warn('Unable to save settings before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your settings. Please try again.');
                    throw err;
                }));
            }
        }

        if (dirtyPayloadsRef.current.songs) {
            const nextSignature = buildStableSignature(songs);
            if (syncedPayloadSignaturesRef.current.songs === nextSignature) {
                dirtyPayloadsRef.current.songs = false;
            } else {
                pendingWrites.push((async () => {
                    await saveSongs(user.uid, songs);
                    syncedPayloadSignaturesRef.current.songs = nextSignature;
                    dirtyPayloadsRef.current.songs = false;
                })().catch((err) => {
                    console.warn('Unable to save songs before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your songs. Please try again.');
                    throw err;
                }));
            }
        }

        if (dirtyPayloadsRef.current.mediaItems) {
            const nextSignature = buildStableSignature(mediaItems);
            if (syncedPayloadSignaturesRef.current.mediaItems === nextSignature) {
                dirtyPayloadsRef.current.mediaItems = false;
            } else {
                pendingWrites.push((async () => {
                    await saveMediaItems(user.uid, mediaItems);
                    syncedPayloadSignaturesRef.current.mediaItems = nextSignature;
                    dirtyPayloadsRef.current.mediaItems = false;
                })().catch((err) => {
                    console.warn('Unable to save media items before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your media items. Please try again.');
                    throw err;
                }));
            }
        }

        if (dirtyPayloadsRef.current.themes) {
            const nextSignature = buildStableSignature(themes);
            if (syncedPayloadSignaturesRef.current.themes === nextSignature) {
                dirtyPayloadsRef.current.themes = false;
            } else {
                pendingWrites.push((async () => {
                    await saveThemes(user.uid, themes);
                    syncedPayloadSignaturesRef.current.themes = nextSignature;
                    dirtyPayloadsRef.current.themes = false;
                })().catch((err) => {
                    console.warn('Unable to save themes before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your themes. Please try again.');
                    throw err;
                }));
            }
        }

        if (dirtyPayloadsRef.current.presentations) {
            const nextSignature = buildStableSignature(presentations);
            if (syncedPayloadSignaturesRef.current.presentations === nextSignature) {
                dirtyPayloadsRef.current.presentations = false;
            } else {
                pendingWrites.push((async () => {
                    await savePresentations(user.uid, presentations);
                    syncedPayloadSignaturesRef.current.presentations = nextSignature;
                    dirtyPayloadsRef.current.presentations = false;
                })().catch((err) => {
                    console.warn('Unable to save presentations before sign-out.', err);
                    handlePersistenceError(err, 'We could not save your presentations. Please try again.');
                    throw err;
                }));
            }
        }

        if (pendingWrites.length > 0) {
            await Promise.all(pendingWrites);
        }
    }, [activeTranslationId, appSettings, handlePersistenceError, mediaItems, presentations, resTab, sessionItems, songs, themes, translations, user]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.sessionItems) {
            return;
        }

        const nextSignature = buildStableSignature(sessionItems);
        if (syncedPayloadSignaturesRef.current.sessionItems === nextSignature) {
            dirtyPayloadsRef.current.sessionItems = false;
            return;
        }

        const persistSessionItems = async () => {
            try {
                await saveSessionItems(user.uid, sessionItems);
                syncedPayloadSignaturesRef.current.sessionItems = nextSignature;
                dirtyPayloadsRef.current.sessionItems = false;
            } catch (err) {
                console.warn('Unable to save schedule items to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your presentation queue. Please try again.');
            }
        };

        void persistSessionItems();
    }, [handlePersistenceError, sessionItems, user]);

    useEffect(() => {
        if (!selectedBook || bookOptions.some((option) => option.book === selectedBook)) {
            return;
        }

        setSelectedBook('');
        setSelectedChapter('');
    }, [bookOptions, selectedBook]);

    useEffect(() => {
        if (!selectedBook) {
            if (selectedChapter) {
                setSelectedChapter('');
            }
            return;
        }

        if (selectedChapter && chapterOptions.includes(Number.parseInt(selectedChapter, 10))) {
            return;
        }

        setSelectedChapter(chapterOptions[0] ? String(chapterOptions[0]) : '');
    }, [chapterOptions, selectedBook, selectedChapter]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.translations) {
            return;
        }

        const nextSignature = buildStableSignature(translations);
        if (syncedPayloadSignaturesRef.current.translations === nextSignature) {
            dirtyPayloadsRef.current.translations = false;
            return;
        }

        const persistTranslations = async () => {
            try {
                await saveCloudTranslations(user.uid, translations);
                syncedPayloadSignaturesRef.current.translations = nextSignature;
                dirtyPayloadsRef.current.translations = false;
            } catch (err) {
                console.warn('Unable to persist imported Bible translations to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your Bible translations. Please try again.', setTranslationStatus);
            }
        };

        void persistTranslations();
    }, [handlePersistenceError, translations, user]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.settings) {
            return;
        }

        const nextSettingsPayload = buildSettingsPayload(appSettings, activeTranslationId, resTab);
        const nextSignature = buildStableSignature(nextSettingsPayload);
        if (syncedPayloadSignaturesRef.current.settings === nextSignature) {
            dirtyPayloadsRef.current.settings = false;
            return;
        }

        const persistSettings = async () => {
            try {
                await saveUserSettings(user.uid, nextSettingsPayload);
                syncedPayloadSignaturesRef.current.settings = nextSignature;
                dirtyPayloadsRef.current.settings = false;
            } catch (err) {
                console.warn('Unable to save settings to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your settings. Please try again.');
            }
        };

        void persistSettings();
    }, [activeTranslationId, appSettings, handlePersistenceError, resTab, user]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.songs) {
            return;
        }

        const nextSignature = buildStableSignature(songs);
        if (syncedPayloadSignaturesRef.current.songs === nextSignature) {
            dirtyPayloadsRef.current.songs = false;
            return;
        }

        const persistSongs = async () => {
            try {
                await saveSongs(user.uid, songs);
                syncedPayloadSignaturesRef.current.songs = nextSignature;
                dirtyPayloadsRef.current.songs = false;
            } catch (err) {
                console.warn('Unable to save songs to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your songs. Please try again.');
            }
        };

        void persistSongs();
    }, [handlePersistenceError, songs, user]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.mediaItems) {
            return;
        }

        const nextSignature = buildStableSignature(mediaItems);
        if (syncedPayloadSignaturesRef.current.mediaItems === nextSignature) {
            dirtyPayloadsRef.current.mediaItems = false;
            return;
        }

        const persistMediaItems = async () => {
            try {
                await saveMediaItems(user.uid, mediaItems);
                syncedPayloadSignaturesRef.current.mediaItems = nextSignature;
                dirtyPayloadsRef.current.mediaItems = false;
            } catch (err) {
                console.warn('Unable to save media items to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your media items. Please try again.');
            }
        };

        void persistMediaItems();
    }, [handlePersistenceError, mediaItems, user]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.themes) {
            return;
        }

        const nextSignature = buildStableSignature(themes);
        if (syncedPayloadSignaturesRef.current.themes === nextSignature) {
            dirtyPayloadsRef.current.themes = false;
            return;
        }

        const persistThemes = async () => {
            try {
                await saveThemes(user.uid, themes);
                syncedPayloadSignaturesRef.current.themes = nextSignature;
                dirtyPayloadsRef.current.themes = false;
            } catch (err) {
                console.warn('Unable to save themes to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your themes. Please try again.');
            }
        };

        void persistThemes();
    }, [handlePersistenceError, themes, user]);

    useEffect(() => {
        if (!user || !cloudHydratedRef.current || writesPausedRef.current) {
            return;
        }

        if (!dirtyPayloadsRef.current.presentations) {
            return;
        }

        const nextSignature = buildStableSignature(presentations);
        if (syncedPayloadSignaturesRef.current.presentations === nextSignature) {
            dirtyPayloadsRef.current.presentations = false;
            return;
        }

        const persistPresentations = async () => {
            try {
                await savePresentations(user.uid, presentations);
                syncedPayloadSignaturesRef.current.presentations = nextSignature;
                dirtyPayloadsRef.current.presentations = false;
            } catch (err) {
                console.warn('Unable to save presentations to the cloud database.', err);
                handlePersistenceError(err, 'We could not save your presentations. Please try again.');
            }
        };

        void persistPresentations();
    }, [handlePersistenceError, presentations, user]);

    useEffect(() => {
        const s = createSender();
        senderRef.current = s;

        const presenceListener = createProjectorPresenceListener(() => {
            setProjectorDetectedState(true);
            clearProjectorHeartbeatTimeout();
            projectorHeartbeatTimeoutRef.current = window.setTimeout(() => {
                setProjectorDetectedState(false);
            }, 2500);

            if (isSharingRef.current || latestPresentationStateRef.current.type !== 'clear') {
                senderRef.current?.send(latestPresentationStateRef.current);
            }
        });

        const cacheSecondaryScreen = async () => {
            try {
                secondaryScreenRef.current = await getSecondaryScreen();
            } catch (err) {
                console.warn('Unable to cache screen details.', err);
            }
        };

        void cacheSecondaryScreen();

        const interval = window.setInterval(() => {
            if (projectorWindowRef.current) {
                if (projectorWindowRef.current.closed && (isSharingRef.current || externalProjectorDetectedRef.current)) {
                    handleProjectorClosed();
                } else if (!projectorWindowRef.current.closed && !isSharingRef.current) {
                    setSharingState(true);
                }
            }
        }, 500);

        return () => {
            s.close();
            senderRef.current = null;
            presenceListener.close();
            window.clearInterval(interval);
            clearProjectorHeartbeatTimeout();
        };
    }, [clearProjectorHeartbeatTimeout, handleProjectorClosed]);

    const openProjector = async () => {
        let secondaryScreen = secondaryScreenRef.current;

        // Try getting screen details first so it opens on the correct monitor instantly.
        if (!secondaryScreen) {
            try {
                secondaryScreen = await getSecondaryScreen();
                secondaryScreenRef.current = secondaryScreen;
            } catch (err) {
                console.warn('Could not acquire screen details before opening.', err);
            }
        }

        const fallbackWidth = window.screen.availWidth || window.outerWidth;
        const fallbackHeight = window.screen.availHeight || window.outerHeight;
        const left = secondaryScreen?.left ?? secondaryScreen?.availLeft ?? (window.screenX + window.outerWidth);
        const top = secondaryScreen?.top ?? secondaryScreen?.availTop ?? 0;
        const width = secondaryScreen?.width ?? secondaryScreen?.availWidth ?? fallbackWidth;
        const height = secondaryScreen?.height ?? secondaryScreen?.availHeight ?? fallbackHeight;

        const newWin = window.open(
            '',
            'BibleShowProjector',
            `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`
        );

        if (!newWin) {
            setSharingState(false);
            return null;
        }

        newWin.document.write(`<!doctype html><html><head><title>Opening projector...</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden;}</style></head><body></body></html>`);
        newWin.document.close();

        positionProjectorWindow(newWin, secondaryScreen);

        const ensureProjectorPlacement = () => {
            positionProjectorWindow(newWin, secondaryScreen);
        };

        try {
            await newWin.document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch (err) {
            console.warn('Automatic fullscreen request failed.', err);
        }

        newWin.addEventListener('load', ensureProjectorPlacement, { once: true });
        newWin.location.replace('/projector');
        window.setTimeout(ensureProjectorPlacement, 150);
        window.setTimeout(ensureProjectorPlacement, 600);
        setSharingState(true);
        return newWin;
    };

    // --- Actions ---

    const sendToPreview = (item: SlideItem) => {
        setPreviewItem(item);
    };

    const handleScriptureTableSelect = (item: SlideItem) => {
        if (isLiveOffline) {
            sendToPreview(item);
            return;
        }

        void sendItemToLive(item);
    };

    const addToSession = (item: SlideItem) => {
        dirtyPayloadsRef.current.sessionItems = true;
        setSessionItems((currentItems) => (currentItems.some((currentItem) => currentItem.id === item.id) ? currentItems : [...currentItems, item]));
    };

    const moveSessionItem = (itemId: string, direction: 'up' | 'down') => {
        dirtyPayloadsRef.current.sessionItems = true;
        setSessionItems((currentItems) => {
            const currentIndex = currentItems.findIndex((item) => item.id === itemId);
            if (currentIndex === -1) {
                return currentItems;
            }

            const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (targetIndex < 0 || targetIndex >= currentItems.length) {
                return currentItems;
            }

            const nextItems = [...currentItems];
            const [movedItem] = nextItems.splice(currentIndex, 1);
            nextItems.splice(targetIndex, 0, movedItem);
            return nextItems;
        });
    };

    const removeFromSession = (id: string, e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        dirtyPayloadsRef.current.sessionItems = true;
        setSessionItems(sessionItems.filter(i => i.id !== id));
        if (previewItem?.id === id) setPreviewItem(null);
    };

    const sendItemToLive = async (item: SlideItem) => {
        const nextPresentationState: PresentationState = {
            type: 'verse',
            text: item.text,
            reference: formatSlideReference(item),
            segments: item.segments,
        };
        setPreviewItem(item);
        latestPresentationStateRef.current = nextPresentationState;

        const shouldOpen = !projectorWindowRef.current || projectorWindowRef.current.closed;

        if (shouldOpen) {
            projectorWindowRef.current = await openProjector();
            if (!projectorWindowRef.current) {
                handleProjectorClosed();
                return;
            }
        }

        setLiveItem(item);
        setIsLiveOffline(false);
        sendPresentationState(nextPresentationState);
    };

    const sendPreviewToLive = () => {
        if (previewItem) {
            void sendItemToLive(previewItem);
        }
    };

    const sendRangeToLive = async (items: SlideItem[]) => {
        const rangeItem = buildRangeSlideItem(items);
        if (!rangeItem) {
            return;
        }

        await sendItemToLive(rangeItem);
    };

    const runScriptureSearchFromQuery = async (rawQuery: string) => {
        const loadedActiveTranslation = activeTranslation?.verses.length ? activeTranslation : await ensureTranslationLoaded(activeTranslationId);
        const nextScriptureItems = loadedActiveTranslation ? buildTranslationVerseItems(loadedActiveTranslation) : scriptureItems;
        const trimmedQuery = rawQuery.trim();
        if (!trimmedQuery) {
            setCommittedScriptureQuery('');
            lastSubmittedSearchRef.current = '';
            setTranslationStatus(`Enter a scripture reference like John 1 or John 1:13 in ${activeTranslation?.shortName ?? 'your active translation'}.`);
            return;
        }

        const searchMatch = findScriptureMatches(trimmedQuery, nextScriptureItems);
        const normalizedQuery = normalizeReferenceText(trimmedQuery);
        const repeatedSubmission = lastSubmittedSearchRef.current === normalizedQuery;
        const parsedSearchRef = searchMatch?.results[0] ? parseVerseReference(searchMatch.results[0].ref) : null;

        lastSubmittedSearchRef.current = normalizedQuery;
        setCommittedScriptureQuery(trimmedQuery);

        if (parsedSearchRef) {
            setSelectedBook(parsedSearchRef.book);
            setSelectedChapter(String(parsedSearchRef.chapter));
        }

        if (!searchMatch) {
            setTranslationStatus(`No scriptures matched "${trimmedQuery}" in ${activeTranslation?.shortName ?? 'your active translation'}.`);
            return;
        }

        if (searchMatch.results[0]) {
            setPreviewItem(searchMatch.targetRange ? buildRangeSlideItem(searchMatch.targetRange) ?? searchMatch.results[0] : searchMatch.targetVerse ?? searchMatch.results[0]);
        }

        if (searchMatch.targetRange) {
            if (repeatedSubmission) {
                setTranslationStatus(`Projecting ${searchMatch.rangeReference}.`);
                await sendRangeToLive(searchMatch.targetRange);
                return;
            }

            setTranslationStatus(`Showing ${searchMatch.rangeReference}. Press Enter again to project.`);
            return;
        }

        if (searchMatch.targetVerse) {
            if (repeatedSubmission) {
                setTranslationStatus(`Projecting ${searchMatch.targetVerse.ref}.`);
                await sendItemToLive(searchMatch.targetVerse);
                return;
            }

            setTranslationStatus(`Showing ${searchMatch.chapterLabel}. Press Enter again to project ${searchMatch.targetVerse.ref}.`);
            return;
        }

        if (repeatedSubmission && searchMatch.results[0]) {
            setTranslationStatus(`Projecting ${searchMatch.results[0].ref}.`);
            await sendItemToLive(searchMatch.results[0]);
            return;
        }

        if (searchMatch.chapterLabel) {
            setTranslationStatus(`Showing ${searchMatch.chapterLabel}. Press Enter again to project verse 1.`);
            return;
        }

        setTranslationStatus(`Showing ${searchMatch.results.length} scripture matches for "${trimmedQuery}".`);
    };

    const runScriptureSearch = async () => {
        if (resTab !== 'Scriptures') {
            return;
        }

        await runScriptureSearchFromQuery(searchQuery);
    };

    const handleBookSelectionChange = (nextBook: string) => {
        setSelectedBook(nextBook);

        if (!nextBook) {
            setSelectedChapter('');
            setSearchQuery('');
            setCommittedScriptureQuery('');
            lastSubmittedSearchRef.current = '';
            return;
        }

        const nextChapter = bookOptions.find((option) => option.book === nextBook)?.chapters[0];
        if (!nextChapter) {
            return;
        }

        const nextQuery = `${nextBook} ${nextChapter}`;
        setSelectedChapter(String(nextChapter));
        setSearchQuery(nextQuery);
        lastSubmittedSearchRef.current = '';
        void Promise.resolve().then(() => runScriptureSearchFromQuery(nextQuery));
    };

    const handleChapterSelectionChange = (nextChapter: string) => {
        setSelectedChapter(nextChapter);
        if (!selectedBook || !nextChapter) {
            return;
        }

        const nextQuery = `${selectedBook} ${nextChapter}`;
        setSearchQuery(nextQuery);
        lastSubmittedSearchRef.current = '';
        void Promise.resolve().then(() => runScriptureSearchFromQuery(nextQuery));
    };

    const clearLiveScreen = () => {
        setIsLiveOffline(true);
        setLiveItem(null);
        sendPresentationState({ type: 'clear', text: '' });
    };

    const stopSharing = () => {
        if (projectorWindowRef.current && !projectorWindowRef.current.closed) {
            projectorWindowRef.current.close();
        }
        clearLiveScreen();
        handleProjectorClosed();
    };

    const selectTranslation = (translationId: string) => {
        const nextTranslation = translations.find((translation) => translation.id === translationId);
        dirtyPayloadsRef.current.settings = true;

        startTransition(() => {
            setAppSettings((currentSettings) => ({
                ...currentSettings,
                activeTranslationId: translationId,
            }));
            setActiveTranslationId(translationId);
        });
        void ensureTranslationLoaded(translationId);
        lastSubmittedSearchRef.current = '';
        setTranslationStatus(null);

        if (!nextTranslation) {
            return;
        }

        const nextTranslationItems = buildTranslationVerseItems(nextTranslation);

        if (previewItem) {
            const nextPreviewItem = findMatchingProjectedItem(previewItem.ref, nextTranslationItems);
            if (nextPreviewItem) {
                setPreviewItem(nextPreviewItem);
            }
        }

        if (!isLiveOffline && liveItem) {
            const nextLiveItem = findMatchingProjectedItem(liveItem.ref, nextTranslationItems);
            if (nextLiveItem) {
                void sendItemToLive(nextLiveItem);
            }
        }
    };

    const updateAppSetting = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
        dirtyPayloadsRef.current.settings = true;
        setAppSettings((currentSettings) => ({
            ...currentSettings,
            [key]: value,
        }));
    };

    const resetSongEditor = () => {
        setSelectedSongId(null);
        setSongForm({ title: '', author: '', copyright: '', lyrics: '', keySignature: '', tags: '', notes: '' });
    };

    const resetMediaEditor = () => {
        setSelectedMediaItemId(null);
        setMediaForm({ title: '', type: '', source: '', notes: '', duration: '', thumbnailUrl: '', aspectRatio: '' });
    };

    const resetThemeEditor = () => {
        setSelectedThemeId(null);
        setThemeForm({ name: '', background: '#111111', textColor: '#f5f5f5', accentColor: '#00aba9', fontFamily: 'Segoe UI', textSize: '96', notes: '' });
    };

    const resetPresentationEditor = () => {
        setSelectedPresentationId(null);
        setPresentationForm({ title: '', content: '', reference: '', category: 'Announcement', background: '#000000', themeId: '' });
    };

    const editSong = (song: SongItem) => {
        setSelectedSongId(song.id);
        setSongForm({
            title: song.title,
            author: song.author,
            copyright: song.copyright,
            lyrics: song.lyrics,
            keySignature: song.keySignature ?? '',
            tags: song.tags ?? '',
            notes: song.notes ?? '',
        });
        sendToPreview(buildSongSlideItem(song));
    };

    const editMediaItem = (item: MediaItem) => {
        setSelectedMediaItemId(item.id);
        setMediaForm({
            title: item.title,
            type: item.type,
            source: item.source,
            notes: item.notes,
            duration: item.duration ?? '',
            thumbnailUrl: item.thumbnailUrl ?? '',
            aspectRatio: item.aspectRatio ?? '',
        });
    };

    const editTheme = (theme: ThemeItem) => {
        setSelectedThemeId(theme.id);
        setThemeForm({
            name: theme.name,
            background: theme.background,
            textColor: theme.textColor,
            accentColor: theme.accentColor,
            fontFamily: theme.fontFamily ?? 'Segoe UI',
            textSize: String(theme.textSize ?? 96),
            notes: theme.notes ?? '',
        });
    };

    const editPresentation = (presentation: PresentationItem) => {
        setSelectedPresentationId(presentation.id);
        setPresentationForm({
            title: presentation.title,
            content: presentation.content,
            reference: presentation.reference,
            category: presentation.category,
            background: presentation.background,
            themeId: presentation.themeId ?? '',
        });
        sendToPreview(buildPresentationSlideItem(presentation));
    };

    const handleResourceTabChange = (nextTab: ResourceTab) => {
        dirtyPayloadsRef.current.settings = true;
        setResTab(nextTab);
        setSearchQuery('');

        if (nextTab !== 'Scriptures') {
            setCommittedScriptureQuery('');
            lastSubmittedSearchRef.current = '';
        }
    };

    const openTranslationPicker = () => {
        translationImportRef.current?.click();
    };

    const openTranslationFolderPicker = () => {
        translationFolderImportRef.current?.click();
    };

    const downloadActiveTranslation = () => {
        if (!activeTranslation) return;
        const fileName = activeTranslation.sourceFileName ?? `${activeTranslation.shortName || activeTranslation.name}.bib`;
        const content = serializeBibleTranslation(activeTranslation);
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = downloadUrl;
        link.download = fileName.toLowerCase().endsWith('.bib') ? fileName : `${fileName}.bib`;
        link.click();
        URL.revokeObjectURL(downloadUrl);
        setTranslationStatus(`Downloaded ${activeTranslation.shortName}.bib`);
    };

    const importTranslationFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith('.bib'));

        if (files.length === 0) {
            event.target.value = '';
            return;
        }

        try {
            setIsImportingTranslation(true);
            setTranslationStatus(`Importing ${files.length} translation${files.length === 1 ? '' : 's'}...`);
            const parsedTranslations = await Promise.all(files.map((file) => parseBibleTranslationFile(file)));
            const seenIds = new Set<string>();
            const uniqueImportedTranslations = parsedTranslations.filter((translation) => {
                if (seenIds.has(translation.id)) {
                    return false;
                }

                seenIds.add(translation.id);
                return true;
            });

            const existingIds = new Set(translations.map((translation) => translation.id));
            const newTranslations = uniqueImportedTranslations.filter((translation) => !existingIds.has(translation.id));
            const addedTranslationsCount = newTranslations.length;
            const firstAddedTranslationId = newTranslations[0]?.id ?? null;
            const nextTranslations = addedTranslationsCount > 0 ? [...translations, ...newTranslations] : translations;

            if (addedTranslationsCount > 0) {
                if (!user) {
                    throw new Error('No signed-in user available for translation import.');
                }

                await saveCloudTranslations(user.uid, nextTranslations);
                syncedPayloadSignaturesRef.current.translations = buildStableSignature(nextTranslations);
                dirtyPayloadsRef.current.translations = false;
                newTranslations.forEach((translation) => writeCachedTranslation(user.uid, translation));
                startTransition(() => {
                    setTranslations(nextTranslations);
                });
            }

            const nextActiveTranslationId = uniqueImportedTranslations.length === 1
                ? uniqueImportedTranslations[0].id
                : firstAddedTranslationId;

            if (nextActiveTranslationId) {
                dirtyPayloadsRef.current.settings = true;
                startTransition(() => {
                    setAppSettings((currentSettings) => ({
                        ...currentSettings,
                        activeTranslationId: nextActiveTranslationId,
                    }));
                    setActiveTranslationId(nextActiveTranslationId);
                });
            }

            if (addedTranslationsCount === 0) {
                setTranslationStatus('All selected translations were already imported.');
            } else {
                setTranslationStatus(`Imported ${addedTranslationsCount} new translation${addedTranslationsCount === 1 ? '' : 's'}.`);
            }
        } catch {
            setTranslationStatus('We could not open those Bible files. Please check the files and try again.');
        } finally {
            setIsImportingTranslation(false);
            event.target.value = '';
        }
    };

    const addSong = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const title = songForm.title.trim();
        if (!title) {
            return;
        }

        const nextSong = {
            id: selectedSongId ?? createEntityId('song'),
            title,
            author: songForm.author.trim(),
            copyright: songForm.copyright.trim(),
            lyrics: songForm.lyrics.trim(),
            keySignature: songForm.keySignature.trim() || undefined,
            tags: songForm.tags.trim() || undefined,
            notes: songForm.notes.trim() || undefined,
        } satisfies SongItem;

        dirtyPayloadsRef.current.songs = true;
        setSongs((currentSongs) => selectedSongId
            ? currentSongs.map((song) => song.id === selectedSongId ? nextSong : song)
            : [nextSong, ...currentSongs]);
        sendToPreview(buildSongSlideItem(nextSong));
        resetSongEditor();
        setWorkspaceStatus(selectedSongId ? 'Song updated.' : 'Song saved.');
    };

    const removeSong = (songId: string) => {
        dirtyPayloadsRef.current.songs = true;
        setSongs((currentSongs) => currentSongs.filter((song) => song.id !== songId));
    };

    const addMediaItem = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const title = mediaForm.title.trim();
        if (!title) {
            return;
        }

        const nextMediaItem = {
            id: selectedMediaItemId ?? createEntityId('media'),
            title,
            type: mediaForm.type.trim() || 'Image',
            source: mediaForm.source.trim(),
            notes: mediaForm.notes.trim(),
            duration: mediaForm.duration.trim() || undefined,
            thumbnailUrl: mediaForm.thumbnailUrl.trim() || undefined,
            aspectRatio: mediaForm.aspectRatio.trim() || undefined,
        } satisfies MediaItem;

        dirtyPayloadsRef.current.mediaItems = true;
        setMediaItems((currentMediaItems) => selectedMediaItemId
            ? currentMediaItems.map((item) => item.id === selectedMediaItemId ? nextMediaItem : item)
            : [nextMediaItem, ...currentMediaItems]);
        resetMediaEditor();
        setWorkspaceStatus(selectedMediaItemId ? 'Media item updated.' : 'Media item saved.');
    };

    const removeMediaItem = (mediaItemId: string) => {
        dirtyPayloadsRef.current.mediaItems = true;
        setMediaItems((currentMediaItems) => currentMediaItems.filter((item) => item.id !== mediaItemId));
    };

    const addTheme = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = themeForm.name.trim();
        if (!name) {
            return;
        }

        const nextTheme = {
            id: selectedThemeId ?? createEntityId('theme'),
            name,
            background: themeForm.background,
            textColor: themeForm.textColor,
            accentColor: themeForm.accentColor,
            fontFamily: themeForm.fontFamily.trim() || undefined,
            textSize: Number.parseInt(themeForm.textSize, 10) || undefined,
            notes: themeForm.notes.trim() || undefined,
        } satisfies ThemeItem;

        dirtyPayloadsRef.current.themes = true;
        setThemes((currentThemes) => selectedThemeId
            ? currentThemes.map((theme) => theme.id === selectedThemeId ? nextTheme : theme)
            : [nextTheme, ...currentThemes]);
        if (!appSettings.defaultThemeId) {
            updateAppSetting('defaultThemeId', nextTheme.id);
        }
        resetThemeEditor();
        setWorkspaceStatus(selectedThemeId ? 'Theme updated.' : 'Theme saved.');
    };

    const removeTheme = (themeId: string) => {
        dirtyPayloadsRef.current.themes = true;
        setThemes((currentThemes) => currentThemes.filter((theme) => theme.id !== themeId));

        if (appSettings.defaultThemeId === themeId) {
            updateAppSetting('defaultThemeId', null);
        }
    };

    const savePresentation = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const title = presentationForm.title.trim();
        const content = presentationForm.content.trim();
        if (!title || !content) {
            return;
        }

        const nextPresentation = {
            id: selectedPresentationId ?? createEntityId('presentation'),
            title,
            content,
            reference: presentationForm.reference.trim(),
            category: presentationForm.category.trim() || 'Presentation',
            background: presentationForm.background,
            themeId: presentationForm.themeId || null,
        } satisfies PresentationItem;

        dirtyPayloadsRef.current.presentations = true;
        setPresentations((currentPresentations) => selectedPresentationId
            ? currentPresentations.map((presentation) => presentation.id === selectedPresentationId ? nextPresentation : presentation)
            : [nextPresentation, ...currentPresentations]);
        sendToPreview(buildPresentationSlideItem(nextPresentation));
        resetPresentationEditor();
        setWorkspaceStatus(selectedPresentationId ? 'Presentation updated.' : 'Presentation saved.');
    };

    const removePresentation = (presentationId: string) => {
        dirtyPayloadsRef.current.presentations = true;
        setPresentations((currentPresentations) => currentPresentations.filter((presentation) => presentation.id !== presentationId));
    };

    const queuePresentation = (presentation: PresentationItem) => {
        addToSession(buildPresentationSlideItem(presentation));
    };

    const queueSong = (song: SongItem) => {
        addToSession(buildSongSlideItem(song));
    };

    const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setAccountStatus(null);

        try {
            await updateDisplayName(profileForm.displayName);
            setAccountStatus('Profile updated.');
        } catch {
            setAccountStatus('We could not update your profile. Please try again.');
        }
    };

    const sendPasswordReset = async () => {
        if (!user?.email) {
            setAccountStatus('No email address is available for this account.');
            return;
        }

        try {
            await resetPassword(user.email);
            setAccountStatus(`Password reset email sent to ${user.email}.`);
        } catch {
            setAccountStatus('We could not send the password reset email. Please try again.');
        }
    };

    const signOut = async () => {
        const hasPendingWrites = Object.values(dirtyPayloadsRef.current).some(Boolean);

        if (hasPendingWrites) {
            try {
                setWorkspaceStatus('Saving your latest changes...');
                await flushPendingCloudWrites();
            } catch {
                return;
            }
        }

        try {
            await signOutUser();
        } catch {
            setWorkspaceStatus('We could not sign you out. Please try again.');
        }
    };

    const resourcePreviewText =
        resTab === 'Scriptures'
            ? previewItem?.text ?? 'Select an item to preview'
            : resTab === 'Songs'
                ? selectedSong?.lyrics || filteredSongs[0]?.lyrics || 'Create a song to save it to your account.'
                : resTab === 'Media'
                    ? selectedMediaItem?.notes || selectedMediaItem?.source || filteredMediaItems[0]?.notes || filteredMediaItems[0]?.source || 'Create a media item to save it to your account.'
                    : resTab === 'Presentations'
                        ? selectedPresentation?.content || filteredPresentationItems[0]?.content || 'Create a presentation and queue it to the service order.'
                        : resTab === 'Themes'
                            ? selectedTheme ? `${selectedTheme.name}\nBackground: ${selectedTheme.background}\nText: ${selectedTheme.textColor}` : filteredThemes[0] ? `${filteredThemes[0].name}\nBackground: ${filteredThemes[0].background}\nText: ${filteredThemes[0].textColor}` : 'Create a theme to save it to your account.'
                            : `Default theme: ${activeTheme?.name ?? 'None'}\nProjector background: ${appSettings.projectorBackground}`;

    const resourcePreviewFooter =
        resTab === 'Scriptures'
            ? committedScriptureQuery
                ? `${filteredScriptureItems.length} verses in ${activeTranslation?.shortName ?? ''}`
                : `Waiting for a scripture search in ${activeTranslation?.shortName ?? ''}`
            : resTab === 'Songs'
                ? `${filteredSongs.length} song${filteredSongs.length === 1 ? '' : 's'} synced`
                : resTab === 'Media'
                    ? `${filteredMediaItems.length} media item${filteredMediaItems.length === 1 ? '' : 's'} synced`
                    : resTab === 'Presentations'
                        ? `${filteredPresentationItems.length} presentation${filteredPresentationItems.length === 1 ? '' : 's'} in the library`
                        : resTab === 'Themes'
                            ? `${filteredThemes.length} theme${filteredThemes.length === 1 ? '' : 's'} synced`
                            : 'Your settings are saved to your account';

    const renderMonitorContent = (item: SlideItem) => (
        <>
            <div className="screen-bg"></div>
            <div className="screen-content scripture-monitor-content">
                <div className="screen-text projector-text scripture-monitor-text">
                    {item.segments && item.segments.length > 0 ? (
                        item.segments.map((segment) => (
                            <span key={`${item.id}-${segment.verseNumber}`} className="projector-verse-segment">
                                <span className="projector-verse-number">{segment.verseNumber}</span>
                                <span>{segment.text}</span>
                            </span>
                        ))
                    ) : (
                        item.text
                    )}
                </div>
                <div className="projector-reference scripture-monitor-reference">{formatSlideReference(item)}</div>
            </div>
        </>
    );

    return (
        <div className="control-panel">
            {/* 1. Menu Bar */}
            <div className="menu-bar">
                <div className="menu-title">
                    <MonitorPlay size={16} className="brand-icon" />
                    Bible Show
                </div>
                <div className="menu-items">
                    <div className="menu-item" title="Coming Soon">File</div>
                    <div className="menu-item" title="Coming Soon">Edit</div>
                    <div className="menu-item" title="Coming Soon">Live</div>
                    <div className="menu-item" title="Coming Soon">Profiles</div>
                    <div className="menu-item" title="Coming Soon">View</div>
                    <div className="menu-item" title="Coming Soon">Help</div>
                </div>
                <div className="menu-account">
                    <span className="menu-account-email">{user?.email ?? 'Not signed in'}</span>
                    <button className="menu-account-btn" onClick={() => void signOut()} type="button">
                        <LogOut size={14} />
                        <span>Sign Out</span>
                    </button>
                </div>
            </div>

            {/* 2. Toolbar */}
            <div className="toolbar">
                <div className="toolbar-section">
                    <button className="tool-btn" title="Coming Soon"><FilePlus size={20} />New</button>
                    <button className="tool-btn" title="Coming Soon"><FolderOpen size={20} />Open</button>
                    <button className="tool-btn" title="Coming Soon"><Save size={20} />Save</button>
                    <button className="tool-btn" title="Coming Soon"><Store size={20} />Store</button>
                    <button className="tool-btn" title="Coming Soon"><Globe size={20} />Web</button>
                </div>
                <div className="toolbar-section" style={{ paddingLeft: '15px' }}>
                    <button className="tool-btn go-live-btn" onClick={sendPreviewToLive} disabled={!previewItem}>
                        <Play size={24} />Go Live
                    </button>
                    <button className="tool-btn" title="Coming Soon"><Bell size={20} />Alerts</button>
                </div>
                <div className="toolbar-section" style={{ paddingLeft: '15px' }}>
                    <button className="tool-btn" onClick={clearLiveScreen}><Image size={20} />Logo</button>
                    <button className="tool-btn" onClick={clearLiveScreen}><Square size={20} fill="currentColor" />Black</button>
                    <button className="tool-btn" onClick={clearLiveScreen}><CircleStop size={20} />Clear</button>
                    <button className="tool-btn" onClick={isLiveOffline ? sendPreviewToLive : stopSharing} style={{ color: isLiveOffline ? '#ccc' : '#e51400' }}><MonitorPlay size={20} />Live</button>
                </div>
                <div className="toolbar-status">{translationStatus ?? workspaceStatus ?? 'Ready'}</div>
            </div>

            <div className="control-panel-body">
                <ResizablePanelGroup
                    className="main-layout"
                    direction="vertical"
                    defaultSizes={[46, 54]}
                    minSizes={[28, 24]}
                    storageKey="bible-show-main-layout"
                >
                    {/* 3. Workspace */}
                    <div className="workspace">
                        <ResizablePanelGroup
                            className="workspace-layout"
                            direction="horizontal"
                            defaultSizes={[20, 48, 32]}
                            minSizes={[14, 24, 18]}
                            storageKey="bible-show-workspace-layout"
                        >
                            {/* Schedule Pane */}
                            <div className="pane">
                                <div className="pane-header">
                                    {resTab === 'Scriptures' ? 'Sidebar' : 'Schedule'}
                                    <div className="pane-actions">
                                        <button className="pane-action-btn"><ChevronDown size={14} /></button>
                                    </div>
                                </div>
                                <div className="pane-content schedule-pane-content">
                                    {resTab === 'Scriptures' ? (
                                        <ResizablePanelGroup
                                            className="schedule-stack-layout"
                                            direction="horizontal"
                                            defaultSizes={[44, 56]}
                                            minSizes={[24, 24]}
                                            storageKey="bible-show-schedule-stack-layout"
                                        >
                                            <div className="schedule-subpane schedule-translation-dock">
                                                <div className="schedule-subpane-header">Translations</div>
                                                <div className="schedule-subpane-body translation-panel">
                                                    <div className="translation-list translation-list-compact" role="listbox" aria-label="Bible translations">
                                                        {sortedTranslations.map((translation) => {
                                                            const isActiveTranslation = activeTranslation && translation.id === activeTranslation.id;

                                                            return (
                                                                <button
                                                                    key={translation.id}
                                                                    className={`translation-list-item translation-list-item-compact ${isActiveTranslation ? 'active' : ''}`}
                                                                    onClick={() => selectTranslation(translation.id)}
                                                                    title={translation.name}
                                                                >
                                                                    <span>{translation.shortName}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="schedule-subpane">
                                                <div className="schedule-subpane-header">Schedule</div>
                                                <div className="schedule-subpane-body schedule-list">
                                                    {sessionItems.length === 0 ? (
                                                        <div style={{ color: '#666', padding: '15px', fontSize: '12px', textAlign: 'center' }}>
                                                            Drag items here to build a schedule, <br />or add from the Resources below.
                                                        </div>
                                                    ) : (
                                                        sessionItems.map(item => (
                                                            <div key={item.id}
                                                                className={`schedule-item ${previewItem?.id === item.id ? 'active' : ''}`}
                                                                onClick={() => sendToPreview(item)}
                                                                onDoubleClick={() => sendItemToLive(item)}
                                                                tabIndex={0}
                                                                onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter') void sendItemToLive(item); }}
                                                            >
                                                                <span style={{ fontWeight: 'bold' }}>{formatSlideReference(item)}</span>
                                                                <div className="schedule-item-actions">
                                                                    <button onClick={() => moveSessionItem(item.id, 'up')} className="pane-action-btn" title="Move up" type="button">Up</button>
                                                                    <button onClick={() => moveSessionItem(item.id, 'down')} className="pane-action-btn" title="Move down" type="button">Down</button>
                                                                    <button onClick={(e) => removeFromSession(item.id, e)} className="pane-action-btn" title="Remove" type="button">
                                                                        <XCircle size={14} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </ResizablePanelGroup>
                                    ) : (
                                        <div className="schedule-list">
                                            {sessionItems.length === 0 ? (
                                                <div style={{ color: '#666', padding: '15px', fontSize: '12px', textAlign: 'center' }}>
                                                    Drag items here to build a schedule, <br />or add from the Resources below.
                                                </div>
                                            ) : (
                                                sessionItems.map(item => (
                                                    <div key={item.id}
                                                        className={`schedule-item ${previewItem?.id === item.id ? 'active' : ''}`}
                                                        onClick={() => sendToPreview(item)}
                                                        onDoubleClick={() => sendItemToLive(item)}
                                                        tabIndex={0}
                                                        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter') void sendItemToLive(item); }}
                                                    >
                                                        <span style={{ fontWeight: 'bold' }}>{formatSlideReference(item)}</span>
                                                        <div className="schedule-item-actions">
                                                            <button onClick={() => moveSessionItem(item.id, 'up')} className="pane-action-btn" title="Move up" type="button">Up</button>
                                                            <button onClick={() => moveSessionItem(item.id, 'down')} className="pane-action-btn" title="Move down" type="button">Down</button>
                                                            <button onClick={(e) => removeFromSession(item.id, e)} className="pane-action-btn" title="Remove" type="button">
                                                                <XCircle size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Live Output Viewer (Grid) */}
                            <div className="pane">
                                <div className="pane-header">Live Workspace</div>
                                <div className="pane-content slides-grid">

                                    <div className="slide-card slide-card-info">
                                        <div className="slide-text">
                                            <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px', color: '#888' }}>Coming Soon</div>
                                            Live Workspace will display slides for songs, media, and presentations.
                                            <br /><br />
                                            Add scriptures to the Schedule using the "Add" button in the Resource area (bottom) to use them.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Monitors */}
                            <div className="pane monitors-pane">
                                <ResizablePanelGroup
                                    className="monitors-layout"
                                    direction="vertical"
                                    defaultSizes={[50, 50]}
                                    minSizes={[24, 24]}
                                    storageKey="bible-show-monitors-layout"
                                >
                                    <div className="monitor-wrapper">
                                        <div className="monitor-title" style={{ color: isLiveOffline ? '#888' : '#e51400' }}>Live Output</div>
                                        <div className={`monitor ${!isLiveOffline ? 'live-active' : ''}`}>
                                            {!isLiveOffline && liveItem ? (
                                                renderMonitorContent(liveItem)
                                            ) : (
                                                <div className="placeholder-text">Logo / Black</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="monitor-wrapper">
                                        <div className="monitor-title" style={{ color: '#f39c12' }}>Preview</div>
                                        <div className="monitor">
                                            {previewItem ? (
                                                renderMonitorContent(previewItem)
                                            ) : (
                                                <div className="placeholder-text">Select an item</div>
                                            )}
                                        </div>
                                    </div>
                                </ResizablePanelGroup>
                            </div>
                        </ResizablePanelGroup>
                    </div>

                    {/* 4. Resources Area */}
                    <div className="resources-area">
                        <div className="resources-tabs">
                            {RESOURCE_TABS.map(tab => (
                                <button key={tab} className={`res-tab ${resTab === tab ? 'active' : ''}`} onClick={() => handleResourceTabChange(tab)}>
                                    {tab}
                                </button>
                            ))}
                            <div className="res-tab-actions">
                                <button className="pane-action-btn"><ChevronDown size={14} /></button>
                            </div>
                        </div>

                        <ResizablePanelGroup
                            className="resources-content"
                            direction="horizontal"
                            defaultSizes={[20, 48, 32]}
                            minSizes={[14, 24, 18]}
                            storageKey="bible-show-resources-layout"
                        >
                            {/* Collections Pane */}
                            <div className="res-collections">
                                <div className="collections-controls">
                                    <div className="collection-search">
                                        <input
                                            type="text"
                                            placeholder={resTab === 'Scriptures' ? (activeTranslation ? `Search ${activeTranslation.shortName}...` : 'Search (No translation)...') : 'Search...'}
                                            value={searchQuery}
                                            onChange={(event) => setSearchQuery(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    void runScriptureSearch();
                                                }
                                            }}
                                        />
                                        {resTab === 'Scriptures' && (
                                            <div className="scripture-search-actions">
                                                <button className="translation-btn" onClick={() => void runScriptureSearch()} title="Search scriptures">
                                                    Search
                                                </button>
                                                <button className="translation-btn" onClick={openTranslationPicker} title="Import BibleShow5 .bib translation" disabled={isImportingTranslation}>
                                                    {isImportingTranslation ? 'Loading...' : 'Import'}
                                                </button>
                                                <button className="translation-btn" onClick={openTranslationFolderPicker} title="Import all BibleShow5 .bib translations from a folder" disabled={isImportingTranslation}>
                                                    Folder
                                                </button>
                                                <button className="translation-btn" onClick={downloadActiveTranslation} title="Download active .bib translation">
                                                    Export
                                                </button>
                                                <input
                                                    ref={translationImportRef}
                                                    type="file"
                                                    accept=".bib"
                                                    multiple
                                                    onChange={importTranslationFile}
                                                    hidden
                                                />
                                                <input
                                                    ref={translationFolderImportRef}
                                                    type="file"
                                                    accept=".bib"
                                                    multiple
                                                    onChange={importTranslationFile}
                                                    hidden
                                                    {...{ webkitdirectory: '', directory: '' }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    {resTab === 'Scriptures' && (
                                        <div className="scripture-navigation-row">
                                            <select
                                                className="scripture-nav-select"
                                                value={selectedBook}
                                                onChange={(event) => handleBookSelectionChange(event.target.value)}
                                            >
                                                <option value="">Book</option>
                                                {bookOptions.map((option) => (
                                                    <option key={option.book} value={option.book}>{option.book}</option>
                                                ))}
                                            </select>
                                            <select
                                                className="scripture-nav-select"
                                                value={selectedChapter}
                                                onChange={(event) => handleChapterSelectionChange(event.target.value)}
                                                disabled={!selectedBook || chapterOptions.length === 0}
                                            >
                                                <option value="">Chapter</option>
                                                {chapterOptions.map((chapter) => (
                                                    <option key={chapter} value={chapter}>{chapter}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                                {resTab !== 'Scriptures' && resTab !== 'Settings' && (
                                    <div className="collections-body">
                                        <div className="collection-item expandable" style={{ background: '#333' }}>
                                            <ChevronDown size={14} className="icon" /> ALL {resTab.toUpperCase()}
                                        </div>
                                        <div className="collection-item expandable">
                                            <ChevronRight size={14} className="icon" /> COLLECTIONS
                                        </div>
                                        <div className="collection-item expandable">
                                            <ChevronRight size={14} className="icon" /> MY COLLECTIONS
                                        </div>
                                    </div>
                                )}
                                {resTab === 'Settings' && (
                                    <div className="collections-body resource-summary-list">
                                        <div className="collection-item expandable" style={{ background: '#333' }}>
                                            <ChevronDown size={14} className="icon" /> ACCOUNT
                                        </div>
                                        <div className="collection-item">{user?.email ?? 'Unknown user'}</div>
                                        <div className="collection-item">Translations: {translations.length}</div>
                                        <div className="collection-item">Songs: {songs.length}</div>
                                        <div className="collection-item">Media: {mediaItems.length}</div>
                                        <div className="collection-item">Presentations: {presentations.length}</div>
                                        <div className="collection-item">Themes: {themes.length}</div>
                                    </div>
                                )}
                            </div>

                            {/* Data Items Pane */}
                            <div className="res-items">
                                {resTab !== 'Settings' && (
                                    <div className="datagrid-header">
                                        <div className="datagrid-cell">Title</div>
                                        <div className="datagrid-cell">{resTab === 'Scriptures' ? 'Translation' : resTab === 'Media' ? 'Type/Ref' : 'Author/Ref'}</div>
                                        <div className="datagrid-cell">{resTab === 'Scriptures' ? 'Verse Text' : resTab === 'Themes' ? 'Colors' : 'Details'}</div>
                                        {(resTab === 'Scriptures' || resTab === 'Songs' || resTab === 'Media' || resTab === 'Themes' || resTab === 'Presentations') && <div className="datagrid-cell datagrid-cell-action">Action</div>}
                                    </div>
                                )}

                                {resTab === 'Songs' && filteredSongs.map(song => (
                                    <div key={song.id} className={`datagrid-row ${selectedSongId === song.id ? 'active previewing' : ''}`} onClick={() => editSong(song)}>
                                        <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{song.title}</div>
                                        <div className="datagrid-cell">{song.author || song.keySignature || 'Song'}</div>
                                        <div className="datagrid-cell">{song.copyright || song.tags || song.notes || 'No song details'}</div>
                                        <div className="datagrid-cell datagrid-cell-action datagrid-action-stack">
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); editSong(song); }} type="button">Edit</button>
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); queueSong(song); }} type="button">Queue</button>
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); void sendItemToLive(buildSongSlideItem(song)); }} type="button">Live</button>
                                            <button className="schedule-add-btn delete-btn" onClick={(event) => { event.stopPropagation(); removeSong(song.id); }} type="button" title="Delete song">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {resTab === 'Scriptures' && visibleScriptureRows.map(verse => (
                                    <div key={verse.id}
                                        className={`datagrid-row ${previewItem?.id === verse.id ? 'active previewing' : ''} ${liveItem?.id === verse.id && !isLiveOffline ? 'live-now' : ''}`}
                                        onClick={() => handleScriptureTableSelect(verse)}
                                        onDoubleClick={() => void sendItemToLive(verse)}
                                        tabIndex={0}
                                        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                                            if (e.key === 'Enter') {
                                                handleScriptureTableSelect(verse);
                                            }
                                        }}
                                    >
                                        <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{verse.ref}</div>
                                        <div className="datagrid-cell">{verse.translationShortName ?? activeTranslation?.shortName ?? ''}</div>
                                        <div className="datagrid-cell">{verse.text.substring(0, 90)}...</div>
                                        <div className="datagrid-cell datagrid-cell-action">
                                            <button
                                                className={`schedule-add-btn ${sessionItemIds.has(verse.id) ? 'saved' : ''}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    addToSession(verse);
                                                }}
                                                type="button"
                                                title={sessionItemIds.has(verse.id) ? 'Already in schedule' : 'Add to schedule'}
                                            >
                                                {sessionItemIds.has(verse.id) ? 'Saved' : 'Add'}
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {resTab === 'Scriptures' && hiddenScriptureRowCount > 0 && (
                                    <div className="scripture-result-summary">
                                        Showing {visibleScriptureRows.length} of {filteredScriptureItems.length} verses. Use search to narrow the rest.
                                    </div>
                                )}

                                {resTab === 'Scriptures' && committedScriptureQuery && filteredScriptureItems.length === 0 && (
                                    <div style={{ color: '#666', padding: '15px', fontSize: '12px', textAlign: 'center' }}>
                                        No scriptures matched your search in {activeTranslation?.name ?? 'your active translation'}.
                                    </div>
                                )}

                                {resTab === 'Scriptures' && !committedScriptureQuery && (
                                    <div className="scripture-result-summary">
                                        Search for a scripture reference to display results.
                                    </div>
                                )}

                                {resTab === 'Media' && filteredMediaItems.map((item) => (
                                    <div key={item.id} className={`datagrid-row ${selectedMediaItemId === item.id ? 'active previewing' : ''}`} onClick={() => editMediaItem(item)}>
                                        <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{item.title}</div>
                                        <div className="datagrid-cell">{item.type}</div>
                                        <div className="datagrid-cell">{item.source || item.notes || item.duration || 'No media details'}</div>
                                        <div className="datagrid-cell datagrid-cell-action datagrid-action-stack">
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); editMediaItem(item); }} type="button">Edit</button>
                                            <button className="schedule-add-btn delete-btn" onClick={(event) => { event.stopPropagation(); removeMediaItem(item.id); }} type="button" title="Delete media item">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {resTab === 'Presentations' && filteredPresentationItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`datagrid-row ${selectedPresentationId === item.id ? 'active previewing' : ''}`}
                                        onClick={() => editPresentation(item)}
                                        onDoubleClick={() => void sendItemToLive(buildPresentationSlideItem(item))}
                                        tabIndex={0}
                                        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                                            if (event.key === 'Enter') {
                                                void sendItemToLive(buildPresentationSlideItem(item));
                                            }
                                        }}
                                    >
                                        <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{item.title}</div>
                                        <div className="datagrid-cell">{item.reference || item.category}</div>
                                        <div className="datagrid-cell">{item.content.substring(0, 90)}...</div>
                                        <div className="datagrid-cell datagrid-cell-action datagrid-action-stack">
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); editPresentation(item); }} type="button">Edit</button>
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); queuePresentation(item); }} type="button">Queue</button>
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); void sendItemToLive(buildPresentationSlideItem(item)); }} type="button">Live</button>
                                            <button className="schedule-add-btn delete-btn" onClick={(event) => { event.stopPropagation(); removePresentation(item.id); }} type="button" title="Delete presentation">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {resTab === 'Themes' && filteredThemes.map((theme) => (
                                    <div key={theme.id} className={`datagrid-row ${selectedThemeId === theme.id ? 'active previewing' : ''}`} onClick={() => editTheme(theme)}>
                                        <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{theme.name}</div>
                                        <div className="datagrid-cell">{appSettings.defaultThemeId === theme.id ? 'Default theme' : theme.fontFamily || 'Theme'}</div>
                                        <div className="datagrid-cell">{theme.background} / {theme.textColor} / {theme.textSize ?? 96}px</div>
                                        <div className="datagrid-cell datagrid-cell-action datagrid-action-stack">
                                            <button className="schedule-add-btn" onClick={(event) => { event.stopPropagation(); editTheme(theme); }} type="button">Edit</button>
                                            <button className={`schedule-add-btn ${appSettings.defaultThemeId === theme.id ? 'saved' : ''}`} onClick={(event) => { event.stopPropagation(); updateAppSetting('defaultThemeId', theme.id); }} type="button">
                                                {appSettings.defaultThemeId === theme.id ? 'Default' : 'Use'}
                                            </button>
                                            <button className="schedule-add-btn delete-btn" onClick={(event) => { event.stopPropagation(); removeTheme(theme.id); }} type="button" title="Delete theme">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {resTab === 'Songs' && (
                                    <form className="resource-form" onSubmit={addSong}>
                                        <div className="resource-form-title">{selectedSongId ? 'Edit Song' : 'Add Song'}</div>
                                        <div className="resource-grid-form">
                                            <input placeholder="Title" value={songForm.title} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, title: event.target.value }))} />
                                            <input placeholder="Author" value={songForm.author} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, author: event.target.value }))} />
                                            <input placeholder="Copyright" value={songForm.copyright} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, copyright: event.target.value }))} />
                                            <input placeholder="Key" value={songForm.keySignature} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, keySignature: event.target.value }))} />
                                            <input placeholder="Tags" value={songForm.tags} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, tags: event.target.value }))} />
                                            <textarea placeholder="Song Notes" rows={2} value={songForm.notes} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, notes: event.target.value }))} />
                                            <textarea placeholder="Lyrics" rows={4} value={songForm.lyrics} onChange={(event) => setSongForm((currentForm) => ({ ...currentForm, lyrics: event.target.value }))} />
                                        </div>
                                        <div className="resource-form-actions">
                                            <button className="translation-btn" type="submit">{selectedSongId ? 'Update Song' : 'Save Song'}</button>
                                            {selectedSongId && <button className="auth-secondary-btn inline-btn" onClick={resetSongEditor} type="button">Cancel</button>}
                                        </div>
                                    </form>
                                )}

                                {resTab === 'Media' && (
                                    <form className="resource-form" onSubmit={addMediaItem}>
                                        <div className="resource-form-title">{selectedMediaItemId ? 'Edit Media' : 'Add Media'}</div>
                                        <div className="resource-grid-form">
                                            <input placeholder="Title" value={mediaForm.title} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, title: event.target.value }))} />
                                            <input placeholder="Type (Image, Video, PDF...)" value={mediaForm.type} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, type: event.target.value }))} />
                                            <input placeholder="Source URL or path" value={mediaForm.source} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, source: event.target.value }))} />
                                            <input placeholder="Duration" value={mediaForm.duration} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, duration: event.target.value }))} />
                                            <input placeholder="Thumbnail URL" value={mediaForm.thumbnailUrl} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, thumbnailUrl: event.target.value }))} />
                                            <input placeholder="Aspect Ratio" value={mediaForm.aspectRatio} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, aspectRatio: event.target.value }))} />
                                            <textarea placeholder="Notes" rows={4} value={mediaForm.notes} onChange={(event) => setMediaForm((currentForm) => ({ ...currentForm, notes: event.target.value }))} />
                                        </div>
                                        <div className="resource-form-actions">
                                            <button className="translation-btn" type="submit">{selectedMediaItemId ? 'Update Media' : 'Save Media'}</button>
                                            {selectedMediaItemId && <button className="auth-secondary-btn inline-btn" onClick={resetMediaEditor} type="button">Cancel</button>}
                                        </div>
                                    </form>
                                )}

                                {resTab === 'Themes' && (
                                    <form className="resource-form" onSubmit={addTheme}>
                                        <div className="resource-form-title">{selectedThemeId ? 'Edit Theme' : 'Add Theme'}</div>
                                        <div className="resource-grid-form resource-grid-form-colors">
                                            <input placeholder="Theme name" value={themeForm.name} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, name: event.target.value }))} />
                                            <label className="resource-color-field"><span>Background</span><input type="color" value={themeForm.background} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, background: event.target.value }))} /></label>
                                            <label className="resource-color-field"><span>Text</span><input type="color" value={themeForm.textColor} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, textColor: event.target.value }))} /></label>
                                            <label className="resource-color-field"><span>Accent</span><input type="color" value={themeForm.accentColor} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, accentColor: event.target.value }))} /></label>
                                            <input placeholder="Font Family" value={themeForm.fontFamily} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, fontFamily: event.target.value }))} />
                                            <input placeholder="Text Size" value={themeForm.textSize} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, textSize: event.target.value }))} />
                                            <textarea placeholder="Theme Notes" rows={2} value={themeForm.notes} onChange={(event) => setThemeForm((currentForm) => ({ ...currentForm, notes: event.target.value }))} />
                                        </div>
                                        <div className="resource-form-actions">
                                            <button className="translation-btn" type="submit">{selectedThemeId ? 'Update Theme' : 'Save Theme'}</button>
                                            {selectedThemeId && <button className="auth-secondary-btn inline-btn" onClick={resetThemeEditor} type="button">Cancel</button>}
                                        </div>
                                    </form>
                                )}

                                {resTab === 'Presentations' && (
                                    <form className="resource-form" onSubmit={savePresentation}>
                                        <div className="resource-form-title">{selectedPresentationId ? 'Edit Presentation' : 'Add Presentation'}</div>
                                        <div className="resource-grid-form resource-grid-form-colors">
                                            <input placeholder="Title" value={presentationForm.title} onChange={(event) => setPresentationForm((currentForm) => ({ ...currentForm, title: event.target.value }))} />
                                            <input placeholder="Reference / Subtitle" value={presentationForm.reference} onChange={(event) => setPresentationForm((currentForm) => ({ ...currentForm, reference: event.target.value }))} />
                                            <input placeholder="Category" value={presentationForm.category} onChange={(event) => setPresentationForm((currentForm) => ({ ...currentForm, category: event.target.value }))} />
                                            <label className="resource-color-field"><span>Background</span><input type="color" value={presentationForm.background} onChange={(event) => setPresentationForm((currentForm) => ({ ...currentForm, background: event.target.value }))} /></label>
                                            <select value={presentationForm.themeId} onChange={(event) => setPresentationForm((currentForm) => ({ ...currentForm, themeId: event.target.value }))}>
                                                <option value="">No Theme</option>
                                                {themes.map((theme) => (
                                                    <option key={theme.id} value={theme.id}>{theme.name}</option>
                                                ))}
                                            </select>
                                            <textarea placeholder="Presentation content" rows={6} value={presentationForm.content} onChange={(event) => setPresentationForm((currentForm) => ({ ...currentForm, content: event.target.value }))} />
                                        </div>
                                        <div className="resource-form-actions">
                                            <button className="translation-btn" type="submit">{selectedPresentationId ? 'Update Presentation' : 'Save Presentation'}</button>
                                            {selectedPresentationId && <button className="auth-secondary-btn inline-btn" onClick={resetPresentationEditor} type="button">Cancel</button>}
                                        </div>
                                    </form>
                                )}

                                {resTab === 'Settings' && (
                                    <div className="settings-stack">
                                        <form className="settings-card" onSubmit={saveProfile}>
                                            <div className="resource-form-title">Profile Management</div>
                                            <label className="settings-field">
                                                <span>Display Name</span>
                                                <input value={profileForm.displayName} onChange={(event) => setProfileForm({ displayName: event.target.value })} />
                                            </label>
                                            <div className="settings-field settings-readonly">
                                                <span>Email</span>
                                                <strong>{user?.email ?? 'No email address'}</strong>
                                            </div>
                                            <div className="resource-form-actions">
                                                <button className="translation-btn" disabled={isAuthenticating} type="submit">Save Profile</button>
                                                <button className="auth-secondary-btn inline-btn" disabled={isAuthenticating} onClick={sendPasswordReset} type="button">Send Password Reset</button>
                                            </div>
                                            {accountStatus && <div className="settings-meta status-text">{accountStatus}</div>}
                                        </form>

                                        <div className="settings-card">
                                            <div className="resource-form-title">Account Settings</div>
                                            <label className="settings-field">
                                                <span>Default Theme</span>
                                                <select value={appSettings.defaultThemeId ?? ''} onChange={(event) => updateAppSetting('defaultThemeId', event.target.value || null)}>
                                                    <option value="">None</option>
                                                    {themes.map((theme) => (
                                                        <option key={theme.id} value={theme.id}>{theme.name}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="settings-field">
                                                <span>Projector Background</span>
                                                <input type="color" value={appSettings.projectorBackground} onChange={(event) => updateAppSetting('projectorBackground', event.target.value)} />
                                            </label>
                                            <label className="settings-field settings-checkbox">
                                                <input type="checkbox" checked={appSettings.showVerseNumbers} onChange={(event) => updateAppSetting('showVerseNumbers', event.target.checked)} />
                                                <span>Show verse numbers in synced settings</span>
                                            </label>
                                            <div className="settings-meta">These values are stored in the cloud workspace and sync across signed-in devices.</div>
                                        </div>
                                    </div>
                                )}

                                {resTab === 'Songs' && filteredSongs.length === 0 && (
                                    <div className="resource-empty-state">No songs saved for this account yet.</div>
                                )}

                                {resTab === 'Media' && filteredMediaItems.length === 0 && (
                                    <div className="resource-empty-state">No media items saved for this account yet.</div>
                                )}

                                {resTab === 'Presentations' && filteredPresentationItems.length === 0 && (
                                    <div className="resource-empty-state">No saved presentations are in this library yet.</div>
                                )}

                                {resTab === 'Themes' && filteredThemes.length === 0 && (
                                    <div className="resource-empty-state">No themes saved for this account yet.</div>
                                )}
                            </div>

                            {/* Quick Preview Pane */}
                            <div className="res-preview-pane">
                                <div className="res-preview-image">
                                    <div className="res-preview-text">
                                        {resourcePreviewText}
                                    </div>
                                </div>
                                <div className="res-preview-footer">
                                    <span>{resourcePreviewFooter}</span>
                                    <span><ListPlus size={14} /> Options</span>
                                </div>
                            </div>
                        </ResizablePanelGroup>
                    </div>
                </ResizablePanelGroup>
            </div>
        </div>
    );
}
