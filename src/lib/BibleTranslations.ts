export interface SlideItem {
    id: string;
    ref: string;
    text: string;
}

export interface BibleTranslation {
    id: string;
    name: string;
    shortName: string;
    verses: SlideItem[];
    sourceFileName?: string;
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
    ['Exodus', ['exo', 'ex', 'exod'] ],
    ['Leviticus', ['lev', 'le', 'lv'] ],
    ['Numbers', ['num', 'nu', 'nm', 'nb'] ],
    ['Deuteronomy', ['deut', 'deu', 'dt'] ],
    ['Joshua', ['josh', 'jos'] ],
    ['Judges', ['judg', 'jdg', 'jg', 'jdgs'] ],
    ['Ruth', ['rth', 'ru'] ],
    ['1 Samuel', ['1samuel', '1 samuel', '1sam', '1 sam', 'i samuel', 'i sam'] ],
    ['2 Samuel', ['2samuel', '2 samuel', '2sam', '2 sam', 'ii samuel', 'ii sam'] ],
    ['1 Kings', ['1kings', '1 kings', '1kgs', '1 kgs', 'i kings', 'i kgs'] ],
    ['2 Kings', ['2kings', '2 kings', '2kgs', '2 kgs', 'ii kings', 'ii kgs'] ],
    ['1 Chronicles', ['1chronicles', '1 chronicles', '1chr', '1 chr', 'i chronicles', 'i chr'] ],
    ['2 Chronicles', ['2chronicles', '2 chronicles', '2chr', '2 chr', 'ii chronicles', 'ii chr'] ],
    ['Ezra', ['ezr'] ],
    ['Nehemiah', ['neh', 'ne'] ],
    ['Esther', ['est', 'es'] ],
    ['Job', ['jb'] ],
    ['Psalm', ['psalm', 'ps', 'psa', 'pslm'] ],
    ['Proverbs', ['prov', 'pro', 'prv', 'pr'] ],
    ['Ecclesiastes', ['eccles', 'eccle', 'ecc', 'ec', 'qoh'] ],
    ['Song of Solomon', ['song of songs', 'song', 'songs', 'sos', 'canticles'] ],
    ['Isaiah', ['isa', 'is'] ],
    ['Jeremiah', ['jer', 'je', 'jr'] ],
    ['Lamentations', ['lam', 'la'] ],
    ['Ezekiel', ['ezek', 'eze', 'ezk'] ],
    ['Daniel', ['dan', 'da', 'dn'] ],
    ['Hosea', ['hos', 'ho'] ],
    ['Joel', ['jl'] ],
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
    ['1 Corinthians', ['1corinthians', '1 corinthians', '1cor', '1 cor', 'i corinthians', 'i cor'] ],
    ['2 Corinthians', ['2corinthians', '2 corinthians', '2cor', '2 cor', 'ii corinthians', 'ii cor'] ],
    ['Galatians', ['gal', 'ga'] ],
    ['Ephesians', ['eph', 'ep'] ],
    ['Philippians', ['phil', 'php', 'pp'] ],
    ['Colossians', ['col', 'co'] ],
    ['1 Thessalonians', ['1thessalonians', '1 thessalonians', '1thess', '1 thess', 'i thessalonians', 'i thess'] ],
    ['2 Thessalonians', ['2thessalonians', '2 thessalonians', '2thess', '2 thess', 'ii thessalonians', 'ii thess'] ],
    ['1 Timothy', ['1timothy', '1 timothy', '1tim', '1 tim', 'i timothy', 'i tim'] ],
    ['2 Timothy', ['2timothy', '2 timothy', '2tim', '2 tim', 'ii timothy', 'ii tim'] ],
    ['Titus', ['tit', 'ti'] ],
    ['Philemon', ['philem', 'phm', 'pm'] ],
    ['Hebrews', ['heb', 'he'] ],
    ['James', ['jas', 'jm'] ],
    ['1 Peter', ['1peter', '1 peter', '1pet', '1 pet', 'i peter', 'i pet'] ],
    ['2 Peter', ['2peter', '2 peter', '2pet', '2 pet', 'ii peter', 'ii pet'] ],
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

function canonicalizeBookName(rawBook: string) {
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

    return {
        id: slugify(baseName) || `translation-${Date.now()}`,
        name,
        shortName,
        verses,
        sourceFileName: fileName,
    } satisfies BibleTranslation;
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