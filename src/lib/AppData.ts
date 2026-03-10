import type { SlideItem } from './BibleTranslations';

export type ResourceTab = 'Songs' | 'Scriptures' | 'Media' | 'Presentations' | 'Themes' | 'Settings';

export interface SongItem {
    id: string;
    title: string;
    author: string;
    copyright: string;
    lyrics: string;
    keySignature?: string;
    tags?: string;
    notes?: string;
}

export interface MediaItem {
    id: string;
    title: string;
    type: string;
    source: string;
    notes: string;
    duration?: string;
    thumbnailUrl?: string;
    aspectRatio?: string;
}

export interface ThemeItem {
    id: string;
    name: string;
    background: string;
    textColor: string;
    accentColor: string;
    fontFamily?: string;
    textSize?: number;
    notes?: string;
}

export interface PresentationItem {
    id: string;
    title: string;
    content: string;
    reference: string;
    category: string;
    background: string;
    themeId: string | null;
}

export interface AppSettings {
    activeTranslationId: string | null;
    selectedResourceTab: ResourceTab;
    defaultThemeId: string | null;
    projectorBackground: string;
    showVerseNumbers: boolean;
}

export interface UserWorkspace {
    sessionItems: SlideItem[];
    songs: SongItem[];
    mediaItems: MediaItem[];
    themes: ThemeItem[];
    presentations: PresentationItem[];
    settings: AppSettings;
}

export const defaultAppSettings: AppSettings = {
    activeTranslationId: null,
    selectedResourceTab: 'Songs',
    defaultThemeId: null,
    projectorBackground: '#000000',
    showVerseNumbers: true,
};
