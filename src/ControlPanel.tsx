import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { createProjectorPresenceListener, createSender, type PresentationState, type VerseSegment } from './lib/Broadcast';
import { canonicalizeBookName, parseBibleTranslationFile, serializeBibleTranslation, type BibleTranslation, type SlideItem } from './lib/BibleTranslations';
import { loadStoredTranslations, saveStoredTranslations } from './lib/BibleTranslationStorage';
import { Play, Square, MonitorPlay, ListPlus, XCircle, FilePlus, FolderOpen, Save, Store, Globe, Bell, Image, CircleStop, ChevronRight, ChevronDown } from 'lucide-react';
import './index.css';

interface ManagedScreen {
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

const builtInVerses: SlideItem[] = [
    { id: 'gen1_1', ref: 'Genesis 1:1', text: 'In the beginning God created the heaven and the earth.' },
    { id: 'jn3_16', ref: 'John 3:16', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
    { id: 'ps23_1', ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
    { id: 'rom8_28', ref: 'Romans 8:28', text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.' },
    { id: 'phil4_13', ref: 'Philippians 4:13', text: 'I can do all things through Christ which strengtheneth me.' }
];

const BUILT_IN_TRANSLATION_ID = 'builtin-kjv1769-sample';
const ACTIVE_TRANSLATION_STORAGE_KEY = 'bible-show-active-translation';
const SCRIPTURE_WORKSPACE_LIMIT = 24;
const SCRIPTURE_TABLE_LIMIT = 250;

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

const builtInTranslation: BibleTranslation = {
    id: BUILT_IN_TRANSLATION_ID,
    name: 'KJV 1769 Sample',
    shortName: 'KJV1769',
    verses: builtInVerses,
    sourceFileName: 'KJV1769.bib',
};

const dummySongs = [
    { id: 's1', title: '10,000 Reasons (Bless The Lord)', author: 'Jonas Myrin | Matt Redman', copyright: '© 2011 Atlas' },
    { id: 's2', title: 'A Heart Like Thine', author: 'Judson Van DeVenter', copyright: 'Public Domain' },
    { id: 's3', title: 'A Mighty Fortress Is Our God', author: 'Hans Leo Hassler | Martin Luther', copyright: 'Public Domain' },
    { id: 's4', title: 'A New Name In Glory', author: 'C. Austin Miles', copyright: 'Public Domain' },
    { id: 's5', title: 'A Robe Of White', author: 'Haldor Lillenas', copyright: 'Public Domain' },
    { id: 's6', title: 'Abide With Me', author: 'Henry F. Lyte | William H. Monk', copyright: 'Public Domain' },
    { id: 's7', title: 'Alas And Did My Savior Bleed', author: 'Hugh Wilson | Isaac Watts', copyright: 'Public Domain' },
];

export default function ControlPanel() {
    const senderRef = useRef<ReturnType<typeof createSender> | null>(null);
    const translationImportRef = useRef<HTMLInputElement | null>(null);
    const translationsHydratedRef = useRef(false);
    const lastSubmittedSearchRef = useRef('');

    // Core State
    const [sessionItems, setSessionItems] = useState<SlideItem[]>([]);
    const [resTab, setResTab] = useState('Songs');
    const [searchQuery, setSearchQuery] = useState('');
    const [committedScriptureQuery, setCommittedScriptureQuery] = useState('');
    const [selectedBook, setSelectedBook] = useState('');
    const [selectedChapter, setSelectedChapter] = useState('');
    const [translations, setTranslations] = useState<BibleTranslation[]>([builtInTranslation]);
    const [activeTranslationId, setActiveTranslationId] = useState(BUILT_IN_TRANSLATION_ID);
    const [translationStatus, setTranslationStatus] = useState<string | null>(null);
    const [isImportingTranslation, setIsImportingTranslation] = useState(false);

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
        if (!managedWindow.getScreenDetails || !('permissions' in navigator)) {
            return null;
        }

        const permissionStatus = await navigator.permissions.query({ name: 'window-management' as PermissionName });
        if (permissionStatus.state !== 'granted') {
            return null;
        }

        const screenDetails = await managedWindow.getScreenDetails();
        return screenDetails.screens.find((screen) => screen !== screenDetails.currentScreen) ?? null;
    };

    const handleProjectorClosed = useCallback(() => {
        projectorWindowRef.current = null;
        setProjectorDetectedState(false);
        clearProjectorHeartbeatTimeout();
        setSharingState(false);
        setIsLiveOffline(true);
        setLiveItem(null);
    }, [clearProjectorHeartbeatTimeout]);

    const activeTranslation = translations.find((translation) => translation.id === activeTranslationId) ?? translations[0] ?? builtInTranslation;
    const scriptureItems = useMemo(
        () => (activeTranslation?.verses ?? builtInVerses).map((verse) => ({
            ...verse,
            translationShortName: verse.translationShortName ?? activeTranslation.shortName,
        })),
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
    const visibleWorkspaceItems = useMemo(
        () => filteredScriptureItems.slice(0, SCRIPTURE_WORKSPACE_LIMIT),
        [filteredScriptureItems],
    );
    const visibleScriptureRows = useMemo(
        () => filteredScriptureItems.slice(0, SCRIPTURE_TABLE_LIMIT),
        [filteredScriptureItems],
    );
    const hiddenWorkspaceItemCount = Math.max(filteredScriptureItems.length - visibleWorkspaceItems.length, 0);
    const hiddenScriptureRowCount = Math.max(filteredScriptureItems.length - visibleScriptureRows.length, 0);

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
        const hydrateTranslations = async () => {
            try {
                window.localStorage.removeItem('bible-show-translations');
                const storedActiveTranslationId = window.localStorage.getItem(ACTIVE_TRANSLATION_STORAGE_KEY);
                const storedTranslations = await loadStoredTranslations();
                const mergedTranslations = [
                    builtInTranslation,
                    ...storedTranslations.filter((translation) => translation.id !== BUILT_IN_TRANSLATION_ID),
                ];

                setTranslations(mergedTranslations);

                if (storedActiveTranslationId && mergedTranslations.some((translation) => translation.id === storedActiveTranslationId)) {
                    setActiveTranslationId(storedActiveTranslationId);
                }
            } catch (err) {
                console.warn('Unable to restore imported Bible translations.', err);
                setTranslationStatus('Unable to restore imported translations from browser storage.');
            } finally {
                translationsHydratedRef.current = true;
            }
        };

        void hydrateTranslations();
    }, []);

    useEffect(() => {
        if (!translationsHydratedRef.current) {
            return;
        }

        const persistTranslations = async () => {
            try {
                const storedTranslations = translations.filter((translation) => translation.id !== BUILT_IN_TRANSLATION_ID);
                await saveStoredTranslations(storedTranslations);
            } catch (err) {
                console.warn('Unable to persist imported Bible translations.', err);
                setTranslationStatus('Unable to save imported translations in browser storage.');
            }
        };

        void persistTranslations();
    }, [translations]);

    useEffect(() => {
        if (!translationsHydratedRef.current) {
            return;
        }

        window.localStorage.setItem(ACTIVE_TRANSLATION_STORAGE_KEY, activeTranslationId);
    }, [activeTranslationId]);

    useEffect(() => {
        const s = createSender();
        senderRef.current = s;

        const presenceListener = createProjectorPresenceListener(() => {
            const wasProjectorDetected = externalProjectorDetectedRef.current;

            setProjectorDetectedState(true);
            clearProjectorHeartbeatTimeout();
            projectorHeartbeatTimeoutRef.current = window.setTimeout(() => {
                setProjectorDetectedState(false);
            }, 2500);

            if (!wasProjectorDetected) {
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
        const left = secondaryScreen?.availLeft ?? (window.screenX + window.outerWidth);
        const top = secondaryScreen?.availTop ?? 0;
        const width = secondaryScreen?.availWidth ?? fallbackWidth;
        const height = secondaryScreen?.availHeight ?? fallbackHeight;

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

        // Safety fallback: if pop-up blocked exact positioning, reposition it
        if (secondaryScreen) {
            newWin.moveTo(secondaryScreen.availLeft, secondaryScreen.availTop);
            newWin.resizeTo(secondaryScreen.availWidth, secondaryScreen.availHeight);
        }

        try {
            await newWin.document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch (err) {
            console.warn('Automatic fullscreen request failed.', err);
        }

        newWin.location.replace('/projector');
        setSharingState(true);
        return newWin;
    };

    // --- Actions ---

    const sendToPreview = (item: SlideItem) => {
        setPreviewItem(item);
    };

    const addToSession = (item: SlideItem) => {
        if (!sessionItems.find(i => i.id === item.id)) {
            setSessionItems([...sessionItems, item]);
        }
    };

    const removeFromSession = (id: string, e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
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
        const trimmedQuery = rawQuery.trim();
        if (!trimmedQuery) {
            setCommittedScriptureQuery('');
            lastSubmittedSearchRef.current = '';
            setTranslationStatus(`Enter a scripture reference like John 1 or John 1:13 in ${activeTranslation.shortName}.`);
            return;
        }

        const searchMatch = findScriptureMatches(trimmedQuery, scriptureItems);
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
            setTranslationStatus(`No scriptures matched "${trimmedQuery}" in ${activeTranslation.shortName}.`);
            return;
        }

        if (searchMatch.results[0]) {
            setPreviewItem(searchMatch.targetRange ? buildRangeSlideItem(searchMatch.targetRange) ?? searchMatch.results[0] : searchMatch.targetVerse ?? searchMatch.results[0]);
        }

        if (searchMatch.targetRange) {
            setTranslationStatus(`Showing and projecting ${searchMatch.rangeReference}.`);
            await sendRangeToLive(searchMatch.targetRange);
            return;
        }

        if (searchMatch.targetVerse) {
            setTranslationStatus(`Showing ${searchMatch.chapterLabel} and projecting ${searchMatch.targetVerse.ref}.`);
            await sendItemToLive(searchMatch.targetVerse);
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
        startTransition(() => {
            setActiveTranslationId(translationId);
        });
        lastSubmittedSearchRef.current = '';
        setTranslationStatus(null);
    };

    const openTranslationPicker = () => {
        translationImportRef.current?.click();
    };

    const downloadActiveTranslation = () => {
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
        const [file] = Array.from(event.target.files ?? []);

        if (!file) {
            return;
        }

        try {
            setIsImportingTranslation(true);
            setTranslationStatus(`Importing ${file.name}...`);
            const parsedTranslation = await parseBibleTranslationFile(file);

            startTransition(() => {
                setTranslations((currentTranslations) => {
                    const filteredTranslations = currentTranslations.filter((translation) => translation.id !== parsedTranslation.id);
                    return [...filteredTranslations, parsedTranslation];
                });
                setActiveTranslationId(parsedTranslation.id);
            });
            setTranslationStatus(`Loaded ${parsedTranslation.name} with ${parsedTranslation.verses.length} verses from ${file.name}.`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to load this .bib file.';
            setTranslationStatus(message);
        } finally {
            setIsImportingTranslation(false);
            event.target.value = '';
        }
    };

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
                    <div className="menu-item">File</div>
                    <div className="menu-item">Edit</div>
                    <div className="menu-item">Live</div>
                    <div className="menu-item">Profiles</div>
                    <div className="menu-item">View</div>
                    <div className="menu-item">Help</div>
                </div>
            </div>

            {/* 2. Toolbar */}
            <div className="toolbar">
                <div className="toolbar-section">
                    <button className="tool-btn"><FilePlus size={20} />New</button>
                    <button className="tool-btn"><FolderOpen size={20} />Open</button>
                    <button className="tool-btn"><Save size={20} />Save</button>
                    <button className="tool-btn"><Store size={20} />Store</button>
                    <button className="tool-btn"><Globe size={20} />Web</button>
                </div>
                <div className="toolbar-section" style={{ paddingLeft: '15px' }}>
                    <button className="tool-btn go-live-btn" onClick={sendPreviewToLive} disabled={!previewItem}>
                        <Play size={24} />Go Live
                    </button>
                    <button className="tool-btn"><Bell size={20} />Alerts</button>
                </div>
                <div className="toolbar-section" style={{ paddingLeft: '15px' }}>
                    <button className="tool-btn" onClick={clearLiveScreen}><Image size={20} />Logo</button>
                    <button className="tool-btn" onClick={clearLiveScreen}><Square size={20} fill="currentColor" />Black</button>
                    <button className="tool-btn" onClick={clearLiveScreen}><CircleStop size={20} />Clear</button>
                    <button className="tool-btn" onClick={isLiveOffline ? sendPreviewToLive : stopSharing} style={{ color: isLiveOffline ? '#ccc' : '#e51400' }}><MonitorPlay size={20} />Live</button>
                </div>
            </div>

            {/* 3. Workspace */}
            <div className="workspace">
                {/* Schedule Pane */}
                <div className="pane">
                    <div className="pane-header">
                        Schedule
                        <div className="pane-actions">
                            <button className="pane-action-btn"><ChevronDown size={14} /></button>
                        </div>
                    </div>
                    <div className="pane-content">
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
                                    <span style={{ fontWeight: 'bold' }}>{item.ref}</span>
                                    <button onClick={(e) => removeFromSession(item.id, e)} className="pane-action-btn" title="Remove">
                                        <XCircle size={14} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Live Output Viewer (Grid) */}
                <div className="pane">
                    <div className="pane-header">Live Workspace</div>
                    <div className="pane-content slides-grid">
                        {visibleWorkspaceItems.map((item) => {
                            const isPreviewing = previewItem?.id === item.id;
                            const isLive = liveItem?.id === item.id && !isLiveOffline;

                            return (
                                <div
                                    key={item.id}
                                    className={`slide-card ${isPreviewing ? 'previewing' : ''} ${isLive ? 'live-now' : ''}`}
                                    onClick={() => (committedScriptureQuery ? void sendItemToLive(item) : sendToPreview(item))}
                                    onDoubleClick={() => sendItemToLive(item)}
                                    tabIndex={0}
                                    onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter') void sendItemToLive(item); }}
                                >
                                    {isLive && <div className="slide-badge badge-live">Live</div>}
                                    {!isLive && isPreviewing && <div className="slide-badge badge-preview">Preview</div>}

                                    <div className="slide-text">"{item.text}"</div>
                                    <div style={{ color: '#888', fontSize: '10px', marginTop: '10px' }}>{formatSlideReference(item)}</div>
                                </div>
                            );
                        })}
                        {hiddenWorkspaceItemCount > 0 && (
                            <div className="slide-card slide-card-info">
                                <div className="slide-text">
                                    Showing the first {visibleWorkspaceItems.length} verses. Search to narrow the remaining {hiddenWorkspaceItemCount} results.
                                </div>
                            </div>
                        )}
                        {resTab === 'Scriptures' && !committedScriptureQuery && (
                            <div className="slide-card slide-card-info">
                                <div className="slide-text">
                                    Search for a scripture reference like ge 1 1, jn 3 16, John 1, or pick a book and chapter below.
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Monitors */}
                <div className="pane monitors-pane">
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

                    <div className="monitor-wrapper" style={{ marginTop: '5px' }}>
                        <div className="monitor-title" style={{ color: '#f39c12' }}>Preview</div>
                        <div className="monitor">
                            {previewItem ? (
                                renderMonitorContent(previewItem)
                            ) : (
                                <div className="placeholder-text">Select an item</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 4. Resources Area */}
            <div className="resources-area">
                <div className="resources-tabs">
                    {['Songs', 'Scriptures', 'Media', 'Presentations', 'Themes'].map(tab => (
                        <button key={tab} className={`res-tab ${resTab === tab ? 'active' : ''}`} onClick={() => setResTab(tab)}>
                            {tab}
                        </button>
                    ))}
                    <div className="res-tab-actions">
                        <button className="pane-action-btn"><ChevronDown size={14} /></button>
                    </div>
                </div>

                <div className="resources-content">
                    {/* Collections Pane */}
                    <div className="res-collections">
                        <div className="collection-search">
                            <input
                                type="text"
                                placeholder={resTab === 'Scriptures' ? `Search ${activeTranslation.shortName}...` : 'Search...'}
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
                                    <button className="translation-btn" onClick={downloadActiveTranslation} title="Download active .bib translation">
                                        Export
                                    </button>
                                    <input
                                        ref={translationImportRef}
                                        type="file"
                                        accept=".bib"
                                        onChange={importTranslationFile}
                                        hidden
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
                        {resTab === 'Scriptures' && (
                            <div className="translation-panel">
                                <div className="translation-panel-header">Translations</div>
                                <div className="translation-list" role="listbox" aria-label="Bible translations">
                                    {translations.map((translation) => {
                                        const isActiveTranslation = translation.id === activeTranslation.id;

                                        return (
                                            <button
                                                key={translation.id}
                                                className={`translation-list-item ${isActiveTranslation ? 'active' : ''}`}
                                                onClick={() => selectTranslation(translation.id)}
                                                title={translation.name}
                                            >
                                                <span>{translation.shortName}</span>
                                                <span>{translation.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="translation-status">
                                    {translationStatus ?? `Using ${activeTranslation.name}`}
                                </div>
                            </div>
                        )}
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

                    {/* Data Items Pane */}
                    <div className="res-items">
                        <div className="datagrid-header">
                            <div className="datagrid-cell">Title</div>
                            <div className="datagrid-cell">{resTab === 'Scriptures' ? 'Translation' : 'Author/Ref'}</div>
                            <div className="datagrid-cell">{resTab === 'Scriptures' ? 'Verse Text' : 'Copyright Info'}</div>
                        </div>

                        {resTab === 'Songs' && dummySongs.map(song => (
                            <div key={song.id} className="datagrid-row">
                                <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{song.title}</div>
                                <div className="datagrid-cell">{song.author}</div>
                                <div className="datagrid-cell">{song.copyright}</div>
                            </div>
                        ))}

                        {resTab === 'Scriptures' && visibleScriptureRows.map(verse => (
                            <div key={verse.id}
                                className={`datagrid-row ${previewItem?.id === verse.id ? 'active' : ''}`}
                                onClick={() => void sendItemToLive(verse)}
                                onDoubleClick={() => { addToSession(verse); void sendItemToLive(verse); }}
                                tabIndex={0}
                                onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                                    if (e.key === 'Enter') { addToSession(verse); void sendItemToLive(verse); }
                                }}
                            >
                                <div className="datagrid-cell" style={{ fontWeight: 'bold' }}>{verse.ref}</div>
                                <div className="datagrid-cell">{activeTranslation.shortName}</div>
                                <div className="datagrid-cell">{verse.text.substring(0, 90)}...</div>
                            </div>
                        ))}

                        {resTab === 'Scriptures' && hiddenScriptureRowCount > 0 && (
                            <div className="scripture-result-summary">
                                Showing {visibleScriptureRows.length} of {filteredScriptureItems.length} verses. Use search to narrow the rest.
                            </div>
                        )}

                        {resTab === 'Scriptures' && committedScriptureQuery && filteredScriptureItems.length === 0 && (
                            <div style={{ color: '#666', padding: '15px', fontSize: '12px', textAlign: 'center' }}>
                                No scriptures matched your search in {activeTranslation.name}.
                            </div>
                        )}

                        {resTab === 'Scriptures' && !committedScriptureQuery && (
                            <div className="scripture-result-summary">
                                Search for a scripture reference to display results.
                            </div>
                        )}

                        {resTab !== 'Songs' && resTab !== 'Scriptures' && (
                            <div style={{ color: '#666', padding: '15px', fontSize: '12px', textAlign: 'center' }}>
                                No items found in {resTab}
                            </div>
                        )}
                    </div>

                    {/* Quick Preview Pane */}
                    <div className="res-preview-pane">
                        <div className="res-preview-image">
                            <div className="res-preview-text">
                                {previewItem ? previewItem.text : (
                                    resTab === 'Songs' ? "Bless the Lord O my soul\nO my soul\nWorship His holy name" : "Select an item to preview"
                                )}
                            </div>
                        </div>
                        <div className="res-preview-footer">
                            <span>
                                {resTab === 'Scriptures'
                                    ? committedScriptureQuery
                                        ? `${filteredScriptureItems.length} verses in ${activeTranslation.shortName}`
                                        : `Waiting for a scripture search in ${activeTranslation.shortName}`
                                    : `1 of 230 ${resTab.toLowerCase()}`}
                            </span>
                            <span><ListPlus size={14} /> Options</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
