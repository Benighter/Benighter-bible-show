import type { SlideTextStyle } from './Broadcast';
import type { SongItem, SongSlide } from './AppData';
import type { SlideItem } from './BibleTranslations';

export const SONG_FONT_OPTIONS = [
    'Segoe UI',
    'Arial',
    'Calibri',
    'Georgia',
    'Tahoma',
    'Trebuchet MS',
    'Verdana',
    'Times New Roman',
    'Garamond',
    'Impact',
];

export const DEFAULT_SONG_SLIDE_STYLE: Required<SlideTextStyle> = {
    fontFamily: 'Segoe UI',
    fontSize: 72,
    color: '#ffffff',
    bold: false,
    italic: false,
    textAlign: 'center',
    verticalAlign: 'middle',
    offsetX: 0,
    offsetY: 0,
    lineHeight: 1.15,
};

function createEntityId(prefix: string) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toFiniteNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSongSlideStyle(style?: SlideTextStyle): Required<SlideTextStyle> {
    return {
        fontFamily: typeof style?.fontFamily === 'string' && style.fontFamily.trim() ? style.fontFamily : DEFAULT_SONG_SLIDE_STYLE.fontFamily,
        fontSize: Math.max(20, Math.min(220, toFiniteNumber(style?.fontSize, DEFAULT_SONG_SLIDE_STYLE.fontSize))),
        color: typeof style?.color === 'string' && style.color.trim() ? style.color : DEFAULT_SONG_SLIDE_STYLE.color,
        bold: typeof style?.bold === 'boolean' ? style.bold : DEFAULT_SONG_SLIDE_STYLE.bold,
        italic: typeof style?.italic === 'boolean' ? style.italic : DEFAULT_SONG_SLIDE_STYLE.italic,
        textAlign: style?.textAlign ?? DEFAULT_SONG_SLIDE_STYLE.textAlign,
        verticalAlign: style?.verticalAlign ?? DEFAULT_SONG_SLIDE_STYLE.verticalAlign,
        offsetX: Math.max(-240, Math.min(240, toFiniteNumber(style?.offsetX, DEFAULT_SONG_SLIDE_STYLE.offsetX))),
        offsetY: Math.max(-200, Math.min(200, toFiniteNumber(style?.offsetY, DEFAULT_SONG_SLIDE_STYLE.offsetY))),
        lineHeight: Math.max(0.9, Math.min(2, toFiniteNumber(style?.lineHeight, DEFAULT_SONG_SLIDE_STYLE.lineHeight))),
    };
}

function createDefaultSlideTitle(index: number) {
    return `Slide ${index + 1}`;
}

export function createSongSlide(overrides: Partial<SongSlide> = {}, index = 0): SongSlide {
    return {
        id: overrides.id ?? createEntityId('song-slide'),
        title: overrides.title?.trim() || createDefaultSlideTitle(index),
        content: overrides.content ?? '',
        style: normalizeSongSlideStyle(overrides.style),
    };
}

export function normalizeSongSlides(song: Pick<SongItem, 'slides' | 'lyrics'>): SongSlide[] {
    if (Array.isArray(song.slides) && song.slides.length > 0) {
        return song.slides.map((slide, index) => createSongSlide(slide, index));
    }

    const lyricSections = song.lyrics
        .split(/\r?\n\s*\r?\n/g)
        .map((section) => section.trim())
        .filter(Boolean);

    if (lyricSections.length > 0) {
        return lyricSections.map((section, index) => createSongSlide({ content: section }, index));
    }

    return [createSongSlide({}, 0)];
}

export function buildSongLyricsFromSlides(slides: SongSlide[]) {
    return slides
        .map((slide) => slide.content.trim())
        .filter(Boolean)
        .join('\n\n');
}

export function buildSongSlideItems(song: SongItem): SlideItem[] {
    const slides = normalizeSongSlides(song);

    return slides.map((slide, index) => ({
        id: `song-slide-${song.id}-${slide.id}`,
        ref: slide.title?.trim() ? `${song.title} • ${slide.title}` : song.title,
        text: slide.content.trim() || song.title,
        translationShortName: song.keySignature ? `${slide.title} • ${song.keySignature}` : slide.title || `Slide ${index + 1}`,
        kind: 'song',
        slideStyle: normalizeSongSlideStyle(slide.style),
    }));
}

export function buildSongSlideItem(song: SongItem, slideId?: string | null): SlideItem {
    const slideItems = buildSongSlideItems(song);
    const matchedItem = slideId ? slideItems.find((item) => item.id.endsWith(`-${slideId}`)) : null;
    return matchedItem ?? slideItems[0] ?? {
        id: `song-slide-${song.id}`,
        ref: song.title,
        text: song.title,
        translationShortName: 'Song',
        kind: 'song',
        slideStyle: DEFAULT_SONG_SLIDE_STYLE,
    };
}

export function getSongPreviewText(song: SongItem | null) {
    if (!song) {
        return null;
    }

    return buildSongSlideItem(song).text;
}

export function mergeSongSlideStyle(style?: SlideTextStyle) {
    return normalizeSongSlideStyle(style);
}