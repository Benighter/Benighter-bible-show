import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type FormEvent as ReactFormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ListPlus, Save, Trash2, X } from 'lucide-react';
import type { SlideTextAlign, SlideTextStyle, SlideVerticalAlign } from './lib/Broadcast';
import type { SongCategory, SongSlide } from './lib/AppData';
import { DEFAULT_SONG_SLIDE_STYLE, SONG_FONT_OPTIONS, mergeSongSlideStyle } from './lib/SongSlides';

export interface SongEditorDraft {
    title: string;
    author: string;
    copyright: string;
    categoryId: string;
    keySignature: string;
    tags: string;
    notes: string;
    slides: SongSlide[];
}

type SongEditorModalProps = {
    isOpen: boolean;
    isEditing: boolean;
    draft: SongEditorDraft;
    songCategories: SongCategory[];
    activeSlideId: string | null;
    onClose: () => void;
    onSave: (event: FormEvent<HTMLFormElement>) => void;
    onDraftFieldChange: <Key extends keyof SongEditorDraft>(field: Key, value: SongEditorDraft[Key]) => void;
    onSlideSelect: (slideId: string) => void;
    onSlideAdd: () => void;
    onSlideDelete: (slideId: string) => void;
    onSlideChange: (slideId: string, patch: Partial<SongSlide>) => void;
    onSlideStyleChange: (slideId: string, patch: Partial<SlideTextStyle>) => void;
};

type ModalRect = {
    width: number;
    height: number;
    left: number;
    top: number;
};

type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const MIN_MODAL_WIDTH = 900;
const MIN_MODAL_HEIGHT = 560;

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function buildInitialModalRect(): ModalRect {
    const width = Math.min(Math.max(window.innerWidth - 120, MIN_MODAL_WIDTH), 1320);
    const height = Math.min(Math.max(window.innerHeight - 100, MIN_MODAL_HEIGHT), 860);

    return {
        width,
        height,
        left: Math.max((window.innerWidth - width) / 2, 24),
        top: Math.max((window.innerHeight - height) / 2, 24),
    };
}

function getJustifyContent(verticalAlign: SlideVerticalAlign) {
    if (verticalAlign === 'top') {
        return 'flex-start';
    }

    if (verticalAlign === 'bottom') {
        return 'flex-end';
    }

    return 'center';
}

function createPreviewStyle(style: SlideTextStyle | undefined): CSSProperties {
    const merged = mergeSongSlideStyle(style);

    return {
        fontFamily: merged.fontFamily,
        fontSize: `clamp(24px, ${Math.max(26, merged.fontSize * 0.12)}px + 1.2vw, ${Math.max(42, merged.fontSize * 0.32)}px)`,
        color: merged.color,
        fontWeight: merged.bold ? 700 : 400,
        fontStyle: merged.italic ? 'italic' : 'normal',
        lineHeight: merged.lineHeight,
        textAlign: merged.textAlign,
        width: '100%',
    };
}

function StyleToggleButton({
    active,
    label,
    onClick,
    onPointerDown,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
    onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
    return (
        <button
            className={`song-editor-toggle ${active ? 'active' : ''}`}
            onClick={onClick}
            onPointerDown={onPointerDown}
            type="button"
        >
            {label}
        </button>
    );
}

const PRESET_COLORS = [
    '#ffffff',
    '#cccccc',
    '#ff0000',
    '#ff9900',
    '#ffff00',
    '#00cc00',
    '#00ccff',
    '#0066cc',
    '#9900cc',
    '#ff00ff',
];

function ColorPickerDropdown({
    color,
    onChange,
}: {
    color: string;
    onChange: (color: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const nativeInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div className="color-picker-dropdown" ref={containerRef}>
            <button
                type="button"
                className="color-picker-trigger"
                style={{ backgroundColor: color || '#ffffff' }}
                onClick={() => setIsOpen((prev) => !prev)}
                title="Change Color"
            />
            {isOpen && (
                <div className="color-picker-popover">
                    <div className="color-picker-label">Standard Colors</div>
                    <div className="color-preset-grid">
                        {PRESET_COLORS.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                className="color-preset-btn"
                                style={{ backgroundColor: preset }}
                                onClick={() => {
                                    onChange(preset);
                                    setIsOpen(false);
                                }}
                                title={preset}
                            />
                        ))}
                    </div>
                    <button
                        type="button"
                        className="color-custom-btn"
                        onClick={() => nativeInputRef.current?.click()}
                    >
                        Custom Color...
                    </button>
                    <input
                        ref={nativeInputRef}
                        type="color"
                        value={color}
                        onChange={(e) => {
                            onChange(e.target.value);
                            setIsOpen(false);
                        }}
                        className="color-custom-input"
                    />
                </div>
            )}
        </div>
    );
}

function StyleField({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <label className="song-editor-toolbar-field">
            <span>{label}</span>
            {children}
        </label>
    );
}

export default function SongEditorModal({
    isOpen,
    isEditing,
    draft,
    songCategories,
    activeSlideId,
    onClose,
    onSave,
    onDraftFieldChange,
    onSlideSelect,
    onSlideAdd,
    onSlideDelete,
    onSlideChange,
    onSlideStyleChange,
}: SongEditorModalProps) {
    const stageInputRef = useRef<HTMLDivElement | null>(null);
    const dragPointerIdRef = useRef<number | null>(null);
    const resizePointerIdRef = useRef<number | null>(null);
    const dragStartRef = useRef<{ pointerX: number; pointerY: number; rect: ModalRect } | null>(null);
    const resizeStartRef = useRef<{ pointerX: number; pointerY: number; rect: ModalRect; handle: ResizeHandle } | null>(null);
    const [modalRect, setModalRect] = useState<ModalRect>(() => buildInitialModalRect());
    const [formatState, setFormatState] = useState({ bold: false, italic: false, underline: false, color: '' });

    useEffect(() => {
        const handleSelectionChange = () => {
            if (document.activeElement === stageInputRef.current) {
                setFormatState({
                    bold: document.queryCommandState('bold'),
                    italic: document.queryCommandState('italic'),
                    underline: document.queryCommandState('underline'),
                    color: document.queryCommandValue('foreColor') || '',
                });
            } else {
                setFormatState({ bold: false, italic: false, underline: false, color: '' });
            }
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, []);

    useEffect(() => {
        const handleResize = () => {
            setModalRect((currentRect) => {
                const maxWidth = Math.max(MIN_MODAL_WIDTH, window.innerWidth - 48);
                const maxHeight = Math.max(MIN_MODAL_HEIGHT, window.innerHeight - 48);
                const width = Math.min(currentRect.width, maxWidth);
                const height = Math.min(currentRect.height, maxHeight);

                return {
                    width,
                    height,
                    left: clamp(currentRect.left, 12, Math.max(12, window.innerWidth - width - 12)),
                    top: clamp(currentRect.top, 12, Math.max(12, window.innerHeight - height - 12)),
                };
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const activeSlide = draft.slides.find((slide) => slide.id === activeSlideId) ?? draft.slides[0];
    const activeStyle = mergeSongSlideStyle(activeSlide?.style ?? DEFAULT_SONG_SLIDE_STYLE);
    const slidePreviewStyle = createPreviewStyle(activeStyle);
    const modalStyle = useMemo<CSSProperties>(() => {
        return {
            width: `${modalRect.width}px`,
            height: `${modalRect.height}px`,
            left: `${modalRect.left}px`,
            top: `${modalRect.top}px`,
        };
    }, [modalRect]);

    const updateSlideStyle = (patch: Partial<SlideTextStyle>) => {
        if (!activeSlide) {
            return;
        }

        onSlideStyleChange(activeSlide.id, patch);
    };

    const setTextAlign = (textAlign: SlideTextAlign) => {
        updateSlideStyle({ textAlign, offsetX: 0 });
    };

    const setVerticalAlign = (verticalAlign: SlideVerticalAlign) => {
        updateSlideStyle({ verticalAlign, offsetY: 0 });
    };

    const handleFormatToggle = (command: string) => {
        const selection = window.getSelection();
        const hasTextFocus = document.activeElement === stageInputRef.current || (selection && selection.rangeCount > 0 && stageInputRef.current?.contains(selection.anchorNode));

        if (hasTextFocus && !selection?.isCollapsed) {
            document.execCommand(command, false);
            if (stageInputRef.current) {
                onSlideChange(activeSlide!.id, { content: stageInputRef.current.innerHTML });
            }
        }
    };

    const handleColorChange = (color: string) => {
        const selection = window.getSelection();
        const hasTextFocus = document.activeElement === stageInputRef.current || (selection && selection.rangeCount > 0 && stageInputRef.current?.contains(selection.anchorNode));

        if (hasTextFocus && !selection?.isCollapsed) {
            document.execCommand('foreColor', false, color);
            if (stageInputRef.current) {
                // Fix for underline color: browser natively wraps color inside <u>, causing the underline to remain default color.
                // We run a regex replacement to restructure: <u><font color="...">text</font></u> -> <font color="..."><u>text</u></font>
                let htmlContent = stageInputRef.current.innerHTML;

                // Matches <u> followed eventually by a color tag (span or font) and performs swaps
                const underlineFixRegex = /(<u[^>]*>)\s*(<span[^>]*color:(.*?);[^>]*>|<font[^>]*color=["'](.*?)["'][^>]*>)(.*?)(<\/span>|<\/font>)\s*<\/u>/gi;

                // Keep swapping until no more nested matches are found, due to possible multiple elements
                let previousHtml = '';
                while (htmlContent !== previousHtml) {
                    previousHtml = htmlContent;
                    htmlContent = htmlContent.replace(underlineFixRegex, '$2$1$5</u>$6');
                }

                if (stageInputRef.current.innerHTML !== htmlContent) {
                    stageInputRef.current.innerHTML = htmlContent;
                }

                onSlideChange(activeSlide!.id, { content: htmlContent });
            }
        }
    };

    const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, select, textarea, label')) {
            return;
        }

        dragPointerIdRef.current = event.pointerId;
        dragStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            rect: modalRect,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragPointerIdRef.current !== event.pointerId || !dragStartRef.current) {
            return;
        }

        const deltaX = event.clientX - dragStartRef.current.pointerX;
        const deltaY = event.clientY - dragStartRef.current.pointerY;
        const nextLeft = clamp(dragStartRef.current.rect.left + deltaX, 12, Math.max(12, window.innerWidth - dragStartRef.current.rect.width - 12));
        const nextTop = clamp(dragStartRef.current.rect.top + deltaY, 12, Math.max(12, window.innerHeight - dragStartRef.current.rect.height - 12));

        setModalRect({
            ...dragStartRef.current.rect,
            left: nextLeft,
            top: nextTop,
        });
    };

    const handleDragPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragPointerIdRef.current !== event.pointerId) {
            return;
        }

        dragPointerIdRef.current = null;
        dragStartRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const handleResizePointerDown = (handle: ResizeHandle) => (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!modalRect) {
            return;
        }

        resizePointerIdRef.current = event.pointerId;
        resizeStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            rect: modalRect,
            handle,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (resizePointerIdRef.current !== event.pointerId || !resizeStartRef.current) {
            return;
        }

        const { rect, handle, pointerX, pointerY } = resizeStartRef.current;
        const deltaX = event.clientX - pointerX;
        const deltaY = event.clientY - pointerY;
        const maxWidth = Math.max(MIN_MODAL_WIDTH, window.innerWidth - 24);
        const maxHeight = Math.max(MIN_MODAL_HEIGHT, window.innerHeight - 24);
        let width = rect.width;
        let height = rect.height;
        let left = rect.left;
        let top = rect.top;

        if (handle.includes('right')) {
            width = clamp(rect.width + deltaX, MIN_MODAL_WIDTH, maxWidth);
        }

        if (handle.includes('left')) {
            width = clamp(rect.width - deltaX, MIN_MODAL_WIDTH, maxWidth);
            left = rect.left + (rect.width - width);
        }

        if (handle.includes('bottom')) {
            height = clamp(rect.height + deltaY, MIN_MODAL_HEIGHT, maxHeight);
        }

        if (handle.includes('top')) {
            height = clamp(rect.height - deltaY, MIN_MODAL_HEIGHT, maxHeight);
            top = rect.top + (rect.height - height);
        }

        setModalRect({
            width,
            height,
            left: clamp(left, 12, Math.max(12, window.innerWidth - width - 12)),
            top: clamp(top, 12, Math.max(12, window.innerHeight - height - 12)),
        });
    };

    const handleResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (resizePointerIdRef.current !== event.pointerId) {
            return;
        }

        resizePointerIdRef.current = null;
        resizeStartRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    useLayoutEffect(() => {
        const editable = stageInputRef.current;
        if (!editable) {
            return;
        }

        const nextText = activeSlide?.content ?? '';
        if (editable.innerHTML !== nextText) {
            editable.innerHTML = nextText;
        }
    }, [activeSlide?.content]);

    const handleSlideContentInput = (event: ReactFormEvent<HTMLDivElement>) => {
        if (!activeSlide) {
            return;
        }

        onSlideChange(activeSlide.id, { content: event.currentTarget.innerHTML });
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="song-modal-overlay" role="presentation">
            <div className="song-modal-backdrop" onClick={onClose} />
            <form className="song-editor-modal" onSubmit={onSave} style={modalStyle}>
                <div
                    className="song-editor-header song-editor-drag-handle"
                    onPointerDown={handleDragPointerDown}
                    onPointerMove={handleDragPointerMove}
                    onPointerUp={handleDragPointerUp}
                >
                    <div className="song-editor-heading">
                        <div className="song-editor-kicker">Songs</div>
                        <h2>{isEditing ? 'Edit Song' : 'New Song'}</h2>
                    </div>
                    <div className="song-editor-header-toolbar">
                        <StyleField label="Font">
                            <select
                                value={activeStyle.fontFamily}
                                onChange={(event) => activeSlide && onSlideStyleChange(activeSlide.id, { fontFamily: event.target.value })}
                            >
                                {SONG_FONT_OPTIONS.map((font) => (
                                    <option key={font} value={font}>{font}</option>
                                ))}
                            </select>
                        </StyleField>
                        <StyleField label="Size">
                            <input
                                max={220}
                                min={20}
                                type="number"
                                value={activeStyle.fontSize}
                                onChange={(event) => activeSlide && onSlideStyleChange(activeSlide.id, { fontSize: Number(event.target.value) })}
                            />
                        </StyleField>
                        <StyleField label="Color">
                            <ColorPickerDropdown
                                color={formatState.color || activeStyle.color || '#ffffff'}
                                onChange={handleColorChange}
                            />
                        </StyleField>
                        <div className="song-editor-toggle-row song-editor-toggle-row-compact">
                            <StyleToggleButton
                                active={formatState.bold}
                                label="B"
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => handleFormatToggle('bold')}
                            />
                            <StyleToggleButton
                                active={formatState.italic}
                                label="I"
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => handleFormatToggle('italic')}
                            />
                            <StyleToggleButton
                                active={formatState.underline}
                                label="U"
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => handleFormatToggle('underline')}
                            />
                        </div>
                        <div className="song-editor-toggle-row song-editor-toggle-row-compact">
                            <StyleToggleButton active={activeStyle.textAlign === 'left'} label="Left" onClick={() => setTextAlign('left')} />
                            <StyleToggleButton active={activeStyle.textAlign === 'center'} label="Center" onClick={() => setTextAlign('center')} />
                            <StyleToggleButton active={activeStyle.textAlign === 'right'} label="Right" onClick={() => setTextAlign('right')} />
                        </div>
                        <div className="song-editor-toggle-row song-editor-toggle-row-compact">
                            <StyleToggleButton active={activeStyle.verticalAlign === 'top'} label="Top" onClick={() => setVerticalAlign('top')} />
                            <StyleToggleButton active={activeStyle.verticalAlign === 'middle'} label="Center" onClick={() => setVerticalAlign('middle')} />
                            <StyleToggleButton active={activeStyle.verticalAlign === 'bottom'} label="Bottom" onClick={() => setVerticalAlign('bottom')} />
                        </div>
                    </div>
                    <div className="song-editor-header-actions">
                        <button className="song-editor-secondary" onClick={onClose} type="button">
                            <X size={16} />
                            <span>Close</span>
                        </button>
                        <button className="song-editor-primary" type="submit">
                            <Save size={16} />
                            <span>{isEditing ? 'Update Song' : 'Save Song'}</span>
                        </button>
                    </div>
                </div>

                <div className="song-editor-layout">
                    <aside className="song-editor-sidebar">
                        <div className="song-editor-sidebar-header">
                            <div>
                                <div className="song-editor-section-label">Slides</div>
                                <strong>{draft.slides.length} total</strong>
                            </div>
                            <button className="song-editor-icon-btn" onClick={onSlideAdd} type="button" title="Add slide">
                                <ListPlus size={16} />
                            </button>
                        </div>
                        <div className="song-editor-slide-list">
                            {draft.slides.map((slide, index) => (
                                <button
                                    key={slide.id}
                                    className={`song-editor-slide-thumb ${activeSlide?.id === slide.id ? 'active' : ''}`}
                                    onClick={() => onSlideSelect(slide.id)}
                                    type="button"
                                >
                                    <span className="song-editor-slide-index">{index + 1}</span>
                                    <span className="song-editor-slide-name">{slide.title || `Slide ${index + 1}`}</span>
                                    <span className="song-editor-slide-excerpt">{slide.content.replace(/<[^>]*>?/gm, '') || 'Empty slide'}</span>
                                </button>
                            ))}
                        </div>
                    </aside>

                    <section className="song-editor-stage-panel">
                        <div className="song-editor-inline-controls">
                            <StyleField label="Slide Title">
                                <input
                                    placeholder="Verse 1"
                                    value={activeSlide?.title ?? ''}
                                    onChange={(event) => activeSlide && onSlideChange(activeSlide.id, { title: event.target.value })}
                                />
                            </StyleField>
                        </div>

                        <div className="song-editor-stage-shell">
                            <div className="song-editor-stage" style={{ justifyContent: getJustifyContent(activeStyle.verticalAlign) }}>
                                <div className="song-editor-stage-glow" />
                                <div className="song-editor-stage-content" style={{ justifyContent: getJustifyContent(activeStyle.verticalAlign) }}>
                                    <div
                                        ref={stageInputRef}
                                        className="song-editor-stage-text song-editor-stage-input"
                                        contentEditable
                                        data-placeholder="Type lyrics directly on the slide"
                                        suppressContentEditableWarning
                                        role="textbox"
                                        aria-multiline="true"
                                        style={slidePreviewStyle}
                                        onInput={handleSlideContentInput}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <aside className="song-editor-inspector">
                        <div className="song-editor-section-label">Song Details</div>
                        <label className="song-editor-field">
                            <span>Title</span>
                            <input value={draft.title} onChange={(event) => onDraftFieldChange('title', event.target.value)} />
                        </label>
                        <label className="song-editor-field">
                            <span>Category</span>
                            <select value={draft.categoryId} onChange={(event) => onDraftFieldChange('categoryId', event.target.value)}>
                                <option value="">All Songs</option>
                                {songCategories.map((category) => (
                                    <option key={category.id} value={category.id}>{category.name}</option>
                                ))}
                            </select>
                        </label>

                        <button
                            className="song-editor-danger"
                            disabled={draft.slides.length <= 1 || !activeSlide}
                            onClick={() => activeSlide && onSlideDelete(activeSlide.id)}
                            type="button"
                        >
                            <Trash2 size={16} />
                            <span>Delete Selected Slide</span>
                        </button>
                    </aside>
                </div>

                {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as ResizeHandle[]).map((handle) => (
                    <div
                        key={handle}
                        className={`song-editor-resize-handle ${handle}`}
                        onPointerDown={handleResizePointerDown(handle)}
                        onPointerMove={handleResizePointerMove}
                        onPointerUp={handleResizePointerUp}
                    />
                ))}
            </form>
        </div>
    );
}