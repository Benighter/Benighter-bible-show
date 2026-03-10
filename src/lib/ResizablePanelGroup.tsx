import { Children, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Fragment } from 'react';

type Direction = 'horizontal' | 'vertical';

type ResizablePanelGroupProps = {
    children: ReactNode;
    className?: string;
    defaultSizes: number[];
    direction: Direction;
    minSizes?: number[];
    storageKey: string;
};

type DragState = {
    index: number;
    startPosition: number;
    startSizes: number[];
};

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function getMinimumSizes(values: number[] | undefined, count: number) {
    return Array.from({ length: count }, (_, index) => clamp(values?.[index] ?? 8, 0, 100));
}

function normalizeSizes(values: number[], count: number) {
    const safeValues = values.slice(0, count).map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
    while (safeValues.length < count) {
        safeValues.push(0);
    }

    const total = safeValues.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
        return Array.from({ length: count }, () => 100 / count);
    }

    return safeValues.map((value) => (value / total) * 100);
}

export function ResizablePanelGroup({
    children,
    className,
    defaultSizes,
    direction,
    minSizes,
    storageKey,
}: ResizablePanelGroupProps) {
    const panels = Children.toArray(children);
    const panelCount = panels.length;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<DragState | null>(null);
    const normalizedDefaults = useMemo(() => normalizeSizes(defaultSizes, panelCount), [defaultSizes, panelCount]);
    const minimumSizes = useMemo(() => getMinimumSizes(minSizes, panelCount), [minSizes, panelCount]);

    const [sizes, setSizes] = useState(() => {
        if (typeof window === 'undefined') {
            return normalizedDefaults;
        }

        const storedValue = window.localStorage.getItem(storageKey);
        if (!storedValue) {
            return normalizedDefaults;
        }

        try {
            const parsedValue = JSON.parse(storedValue);
            if (!Array.isArray(parsedValue)) {
                return normalizedDefaults;
            }

            return normalizeSizes(parsedValue.map((value) => Number(value)), panelCount);
        } catch {
            return normalizedDefaults;
        }
    });

    useEffect(() => {
        window.localStorage.setItem(storageKey, JSON.stringify(sizes));
    }, [sizes, storageKey]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const dragState = dragStateRef.current;
            const container = containerRef.current;
            if (!dragState || !container) {
                return;
            }

            const totalSize = direction === 'horizontal' ? container.clientWidth : container.clientHeight;
            if (totalSize <= 0) {
                return;
            }

            const currentPosition = direction === 'horizontal' ? event.clientX : event.clientY;
            const deltaPercent = ((currentPosition - dragState.startPosition) / totalSize) * 100;
            const nextSizes = [...dragState.startSizes];
            const currentSize = dragState.startSizes[dragState.index];
            const nextSize = dragState.startSizes[dragState.index + 1];
            const combinedSize = currentSize + nextSize;
            const minCurrent = minimumSizes[dragState.index] ?? 8;
            const minNext = minimumSizes[dragState.index + 1] ?? 8;
            const boundedCurrent = clamp(currentSize + deltaPercent, minCurrent, combinedSize - minNext);

            nextSizes[dragState.index] = boundedCurrent;
            nextSizes[dragState.index + 1] = combinedSize - boundedCurrent;
            setSizes(nextSizes);
        };

        const handlePointerUp = () => {
            dragStateRef.current = null;
            document.body.classList.remove('is-resizing-panels');
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [direction, minimumSizes]);

    const handlePointerDown = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStateRef.current = {
            index,
            startPosition: direction === 'horizontal' ? event.clientX : event.clientY,
            startSizes: sizes,
        };
        document.body.classList.add('is-resizing-panels');
        event.preventDefault();
    };

    return (
        <div ref={containerRef} className={`resizable-panel-group ${direction}${className ? ` ${className}` : ''}`}>
            {panels.map((panel, index) => (
                <Fragment key={`group-${index}`}>
                    <div key={`panel-${index}`} className="resizable-panel" style={{ flexBasis: `${sizes[index] ?? 100 / panelCount}%` }}>
                        {panel}
                    </div>
                    {index < panels.length - 1 ? (
                        <div
                            key={`handle-${index}`}
                            className={`resizable-handle ${direction}`}
                            onPointerDown={handlePointerDown(index)}
                            role="separator"
                            aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
                            aria-label="Resize panel"
                            tabIndex={-1}
                        />
                    ) : null}
                </Fragment>
            ))}
        </div>
    );
}