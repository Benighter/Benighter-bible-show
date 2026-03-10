import type { SlideTextStyle, VerseSegment } from './Broadcast';

export interface SlideItem {
    id: string;
    ref: string;
    text: string;
    segments?: VerseSegment[];
    translationShortName?: string;
    kind?: 'scripture' | 'song' | 'presentation';
    slideStyle?: SlideTextStyle;
}

export interface BibleTranslation {
    id: string;
    name: string;
    shortName: string;
    verses: SlideItem[];
    sourceFileName?: string;
}

function decodeHtmlEntities(value: string) {
    if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = value;
        return textarea.value;
    }

    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

export function sanitizeVerseText(value: string) {
    return decodeHtmlEntities(value)
        .replace(/<[^>]+>/g, '')
        .replace(/\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function sanitizeTranslation(translation: BibleTranslation): BibleTranslation {
    return {
        ...translation,
        verses: translation.verses.map((verse) => ({
            ...verse,
            text: sanitizeVerseText(verse.text),
        })),
    };
}

type InfoRow = {
    Parameter?: string;
    Value?: string;
};

type StructureRow = {
    BibPosition?: number;
    Abbreviation?: string;
    FullTitle?: string;
    DisplayTitle?: string;
};

type BibleRow = {
    Book?: number;
    Chapter?: number;
    Verse?: number;
    Scripture?: string;
};

const CANONICAL_BOOKS = [
    ['Genesis', ['gen', 'ge', 'gn']],
    ['Exodus', ['exo', 'ex', 'exod']],
    ['Leviticus', ['lev', 'le', 'lv']],
    ['Numbers', ['num', 'nu', 'nm', 'nb']],
    ['Deuteronomy', ['deut', 'deu', 'dt']],
    ['Joshua', ['josh', 'jos'],],
    ['Judges', ['judg', 'jdg', 'jg', 'jdgs']],
    ['Ruth', ['rth', 'ru'] ],
    ['1 Samuel', ['1samuel', '1 samuel', '1sam', '1 sam', '1sa', '1 sa', 'i samuel', 'i sam', 'i sa'] ],
    ['2 Samuel', ['2samuel', '2 samuel', '2sam', '2 sam', '2sa', '2 sa', 'ii samuel', 'ii sam', 'ii sa'] ],
    ['1 Kings', ['1kings', '1 kings', '1kgs', '1 kgs', '1ki', '1 ki', 'i kings', 'i kgs', 'i ki'] ],
    ['2 Kings', ['2kings', '2 kings', '2kgs', '2 kgs', '2ki', '2 ki', 'ii kings', 'ii kgs', 'ii ki'] ],
    ['1 Chronicles', ['1chronicles', '1 chronicles', '1chr', '1 chr', '1ch', '1 ch', 'i chronicles', 'i chr', 'i ch'] ],
    ['2 Chronicles', ['2chronicles', '2 chronicles', '2chr', '2 chr', '2ch', '2 ch', 'ii chronicles', 'ii chr', 'ii ch'] ],
    ['Ezra', ['ezr'] ],
    ['Nehemiah', ['neh', 'ne'] ],
    ['Esther', ['est', 'es'] ],
    ['Job', ['jb'] ],
    ['Psalm', ['psalm', 'psalms', 'ps', 'psa', 'pslm'] ],
    ['Proverbs', ['prov', 'pro', 'prv', 'pr'] ],
    ['Ecclesiastes', ['eccles', 'eccle', 'ecc', 'ec', 'qoh'] ],
    ['Song of Solomon', ['song of songs', 'song', 'songs', 'sos', 'so', 'canticles'] ],
    ['Isaiah', ['isa', 'is'] ],
    ['Jeremiah', ['jer', 'je', 'jr'] ],
    ['Lamentations', ['lam', 'la'] ],
    ['Ezekiel', ['ezek', 'eze', 'ezk'] ],
    ['Daniel', ['dan', 'da', 'dn'] ],
    ['Hosea', ['hos', 'ho'] ],
    ['Joel', ['jl', 'joe'] ],
    ['Amos', ['am'] ],
    ['Obadiah', ['obad', 'ob'] ],
    ['Jonah', ['jon', 'jnh'] ],
    ['Micah', ['mic', 'mc'] ],
    ['Nahum', ['nah', 'na'] ],
    ['Habakkuk', ['hab', 'hb'] ],
    ['Zephaniah', ['zeph', 'zep', 'zp'] ],
    ['Haggai', ['hag', 'hg'] ],
    ['Zechariah', ['zech', 'zec', 'zc'] ],
    ['Malachi', ['mal', 'ml'] ],
    ['Matthew', ['matt', 'mat', 'mt'] ],
    ['Mark', ['mrk', 'mar', 'mk', 'mr'] ],
    ['Luke', ['luk', 'lk'] ],
    ['John', ['jhn', 'jn', 'joh'] ],
    ['Acts', ['act', 'ac'] ],
    ['Romans', ['rom', 'ro', 'rm'] ],
    ['1 Corinthians', ['1corinthians', '1 corinthians', '1cor', '1 cor', '1co', '1 co', 'i corinthians', 'i cor', 'i co'] ],
    ['2 Corinthians', ['2corinthians', '2 corinthians', '2cor', '2 cor', '2co', '2 co', 'ii corinthians', 'ii cor', 'ii co'] ],
    ['Galatians', ['gal', 'ga'] ],
    ['Ephesians', ['eph', 'ep'] ],
    ['Philippians', ['phil', 'php', 'pp'] ],
    ['Colossians', ['col', 'co'] ],
    ['1 Thessalonians', ['1thessalonians', '1 thessalonians', '1thess', '1 thess', '1th', '1 th', 'i thessalonians', 'i thess', 'i th'] ],
    ['2 Thessalonians', ['2thessalonians', '2 thessalonians', '2thess', '2 thess', '2th', '2 th', 'ii thessalonians', 'ii thess', 'ii th'] ],
    ['1 Timothy', ['1timothy', '1 timothy', '1tim', '1 tim', '1ti', '1 ti', 'i timothy', 'i tim', 'i ti'] ],
    ['2 Timothy', ['2timothy', '2 timothy', '2tim', '2 tim', '2ti', '2 ti', 'ii timothy', 'ii tim', 'ii ti'] ],
    ['Titus', ['tit', 'ti'] ],
    ['Philemon', ['philem', 'phm', 'pm'] ],
    ['Hebrews', ['heb', 'he'] ],
    ['James', ['jas', 'jm'] ],
    ['1 Peter', ['1peter', '1 peter', '1pet', '1 pet', '1pe', '1 pe', 'i peter', 'i pet', 'i pe'] ],
    ['2 Peter', ['2peter', '2 peter', '2pet', '2 pet', '2pe', '2 pe', 'ii peter', 'ii pet', 'ii pe'] ],
    ['1 John', ['1john', '1 john', '1jn', '1 jn', 'i john', 'i jn'] ],
    ['2 John', ['2john', '2 john', '2jn', '2 jn', 'ii john', 'ii jn'] ],
    ['3 John', ['3john', '3 john', '3jn', '3 jn', 'iii john', 'iii jn'] ],
    ['Jude', ['jud'] ],
    ['Revelation', ['rev', 're', 'the revelation'] ],
] as const;

const BOOK_ALIAS_LOOKUP = new Map<string, string>();

for (const [canonicalName, aliases] of CANONICAL_BOOKS) {
    BOOK_ALIAS_LOOKUP.set(normalizeBookKey(canonicalName), canonicalName);
    for (const alias of aliases) {
        BOOK_ALIAS_LOOKUP.set(normalizeBookKey(alias), canonicalName);
    }
}

function normalizeBookKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function canonicalizeBookName(rawBook: string) {
    return BOOK_ALIAS_LOOKUP.get(normalizeBookKey(rawBook)) ?? rawBook.trim();
}

function extractMetadataValue(lines: string[], keys: string[]) {
    for (const line of lines) {
        const trimmed = line.trim();
        const normalized = trimmed.toLowerCase();

        for (const key of keys) {
            const keyWithEquals = `${key.toLowerCase()}=`;
            const keyWithColon = `${key.toLowerCase()}:`;

            if (normalized.startsWith(keyWithEquals)) {
                return trimmed.slice(keyWithEquals.length).trim();
            }

            if (normalized.startsWith(keyWithColon)) {
                return trimmed.slice(keyWithColon.length).trim();
            }

            if (normalized.startsWith(`@${keyWithEquals}`) || normalized.startsWith(`#${keyWithEquals}`)) {
                return trimmed.slice(key.length + 2).trim();
            }

            if (normalized.startsWith(`@${keyWithColon}`) || normalized.startsWith(`#${keyWithColon}`)) {
                return trimmed.slice(key.length + 2).trim();
            }
        }
    }

    return null;
}

function parseDelimitedVerse(line: string, delimiter: string) {
    const fields = line.split(delimiter).map((field) => field.trim());
    if (fields.length < 4) {
        return null;
    }

    const [rawBook, rawChapter, rawVerse, ...textParts] = fields;
    const chapter = Number.parseInt(rawChapter, 10);
    const verse = Number.parseInt(rawVerse, 10);
    const text = textParts.join(` ${delimiter} `).trim();

    if (!rawBook || Number.isNaN(chapter) || Number.isNaN(verse) || !text) {
        return null;
    }

    return {
        book: canonicalizeBookName(rawBook),
        chapter,
        verse,
        text,
    };
}

function parseStructuredVerse(line: string) {
    const tabMatch = line.match(/^(.+?)\t(\d+):(\d+)\t(.+)$/);
    if (tabMatch) {
        return {
            book: canonicalizeBookName(tabMatch[1]),
            chapter: Number.parseInt(tabMatch[2], 10),
            verse: Number.parseInt(tabMatch[3], 10),
            text: tabMatch[4].trim(),
        };
    }

    const pipeMatch = line.match(/^(.+?)\|(\d+):(\d+)\|(.+)$/);
    if (pipeMatch) {
        return {
            book: canonicalizeBookName(pipeMatch[1]),
            chapter: Number.parseInt(pipeMatch[2], 10),
            verse: Number.parseInt(pipeMatch[3], 10),
            text: pipeMatch[4].trim(),
        };
    }

    const spacedMatch = line.match(/^(.+?)\s+(\d+):(\d+)\s+(.+)$/);
    if (spacedMatch) {
        return {
            book: canonicalizeBookName(spacedMatch[1]),
            chapter: Number.parseInt(spacedMatch[2], 10),
            verse: Number.parseInt(spacedMatch[3], 10),
            text: spacedMatch[4].trim(),
        };
    }

    return null;
}

function parseVerseLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@') || trimmed.startsWith(';') || trimmed.startsWith('//')) {
        return null;
    }

    return parseDelimitedVerse(trimmed, '|')
        ?? parseDelimitedVerse(trimmed, '\t')
        ?? parseStructuredVerse(trimmed);
}

function buildTranslation(fileName: string, verses: SlideItem[], metadata?: { name?: string | null; shortName?: string | null }) {
    if (verses.length === 0) {
        throw new Error('No scripture verses were found in this .bib file.');
    }

    const baseName = fileName.replace(/\.bib$/i, '').trim() || 'Imported Translation';
    const name = metadata?.name?.trim() || baseName;
    const shortName = metadata?.shortName?.trim() || baseName;

    return sanitizeTranslation({
        id: slugify(baseName) || `translation-${Date.now()}`,
        name,
        shortName,
        verses,
        sourceFileName: fileName,
    } satisfies BibleTranslation);
}

function parseTextBibleTranslation(content: string, fileName = 'translation.bib') {
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
    const verses: SlideItem[] = [];

    for (const line of lines) {
        const parsedVerse = parseVerseLine(line);
        if (!parsedVerse) {
            continue;
        }

        verses.push({
            id: `${slugify(parsedVerse.book)}-${parsedVerse.chapter}-${parsedVerse.verse}`,
            ref: `${parsedVerse.book} ${parsedVerse.chapter}:${parsedVerse.verse}`,
            text: parsedVerse.text,
        });
    }

    return buildTranslation(fileName, verses, {
        name: extractMetadataValue(lines, ['name', 'title', 'translation']),
        shortName: extractMetadataValue(lines, ['shortname', 'short', 'abbreviation', 'code']),
    });
}

function isJetDatabase(bytes: Uint8Array) {
    const header = new TextDecoder('ascii').decode(bytes.slice(0, 20));
    return header.includes('Standard Jet DB');
}

async function parseJetBibleTranslation(arrayBuffer: ArrayBuffer, fileName: string) {
    const [{ Buffer }, { default: MDBReader }] = await Promise.all([
        import('buffer'),
        import('mdb-reader'),
    ]);

    const reader = new MDBReader(Buffer.from(arrayBuffer));
    const infoRows = reader.getTable('Info').getData<InfoRow>();
    const structureRows = reader.getTable('Structure').getData<StructureRow>();
    const bibleRows = reader.getTable('Bible').getData<BibleRow>();

    const info = new Map<string, string>();
    for (const row of infoRows) {
        if (row.Parameter) {
            info.set(row.Parameter, typeof row.Value === 'string' ? row.Value : '');
        }
    }

    const books = new Map<number, string>();
    for (const row of structureRows) {
        if (!row.BibPosition) {
            continue;
        }

        books.set(
            row.BibPosition,
            canonicalizeBookName(row.DisplayTitle || row.FullTitle || row.Abbreviation || `Book ${row.BibPosition}`),
        );
    }

    const verses: SlideItem[] = bibleRows
        .filter((row) => typeof row.Book === 'number' && typeof row.Chapter === 'number' && typeof row.Verse === 'number' && typeof row.Scripture === 'string')
        .map((row) => {
            const bookName = books.get(row.Book!) ?? `Book ${row.Book}`;
            return {
                id: `${slugify(bookName)}-${row.Chapter}-${row.Verse}`,
                ref: `${bookName} ${row.Chapter}:${row.Verse}`,
                text: row.Scripture!.trim(),
            } satisfies SlideItem;
        })
        .filter((verse) => verse.text.length > 0);

    return buildTranslation(fileName, verses, {
        name: info.get('BibleFullName') ?? info.get('Description') ?? null,
        shortName: info.get('BibleShortName') ?? null,
    });
}

export async function parseBibleTranslationFile(file: File): Promise<BibleTranslation> {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (isJetDatabase(bytes)) {
        return await parseJetBibleTranslation(arrayBuffer, file.name);
    }

    const content = new TextDecoder('utf-8').decode(bytes);
    return parseTextBibleTranslation(content, file.name);
}

export function serializeBibleTranslation(translation: BibleTranslation) {
    const lines = [
        '# Bible Show .bib export',
        `@name=${translation.name}`,
        `@short=${translation.shortName}`,
        '',
    ];

    for (const verse of translation.verses) {
        const refMatch = verse.ref.match(/^(.*)\s+(\d+):(\d+)$/);
        if (!refMatch) {
            continue;
        }

        lines.push(`${refMatch[1]}|${refMatch[2]}|${refMatch[3]}|${verse.text}`);
    }

    return `${lines.join('\n')}\n`;
}