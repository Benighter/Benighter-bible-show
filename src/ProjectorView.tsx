import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createProjectorPresenceBroadcaster, createReceiver, type PresentationState } from './lib/Broadcast';
import './index.css';

function buildProjectorTextStyle(state: PresentationState): CSSProperties {
    const textStyle = state.slideStyle;

    return {
        fontFamily: textStyle?.fontFamily,
        color: textStyle?.color,
        fontWeight: textStyle?.bold ? 700 : undefined,
        fontStyle: textStyle?.italic ? 'italic' : undefined,
        textAlign: textStyle?.textAlign,
        lineHeight: textStyle?.lineHeight,
        width: '100%',
    };
}

function getProjectorJustifyContent(state: PresentationState) {
    const verticalAlign = state.slideStyle?.verticalAlign;

    if (verticalAlign === 'top') {
        return 'flex-start';
    }

    if (verticalAlign === 'bottom') {
        return 'flex-end';
    }

    return 'center';
}

export default function ProjectorView() {
    const [state, setState] = useState<PresentationState>({ type: 'clear', text: '' });
    const frameRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const [textSize, setTextSize] = useState(96);
    const [referenceSize, setReferenceSize] = useState(38);
    const projectorStyle = {
        '--projector-text-size': `${textSize}px`,
        '--projector-reference-size': `${referenceSize}px`,
    } as CSSProperties;

    const requestFullscreen = () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);

    useLayoutEffect(() => {
        if (state.type === 'clear') {
            return;
        }

        const fitContent = () => {
            const frame = frameRef.current;
            const content = contentRef.current;
            if (!frame || !content) {
                return;
            }

            const preferredTextSize = state.slideStyle?.fontSize ?? Math.min(frame.clientWidth * 0.09, frame.clientHeight * 0.17, 110);
            let nextTextSize = Math.min(preferredTextSize, frame.clientHeight * 0.24, frame.clientWidth * 0.14, 180);
            let nextReferenceSize = Math.max(nextTextSize * 0.42, 22);

            content.style.setProperty('--projector-text-size', `${nextTextSize}px`);
            content.style.setProperty('--projector-reference-size', `${nextReferenceSize}px`);

            while (
                nextTextSize > 24
                && (content.scrollHeight > frame.clientHeight || content.scrollWidth > frame.clientWidth)
            ) {
                nextTextSize -= 2;
                nextReferenceSize = Math.max(nextTextSize * 0.42, 18);
                content.style.setProperty('--projector-text-size', `${nextTextSize}px`);
                content.style.setProperty('--projector-reference-size', `${nextReferenceSize}px`);
            }

            setTextSize(nextTextSize);
            setReferenceSize(nextReferenceSize);
        };

        fitContent();

        const resizeObserver = new ResizeObserver(() => {
            fitContent();
        });

        if (frameRef.current) {
            resizeObserver.observe(frameRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [state]);

    useEffect(() => {
        const receiver = createReceiver((newState) => {
            setState(newState);
        });
        const presenceBroadcaster = createProjectorPresenceBroadcaster();

        const requestFS = async () => {
            try {
                if (document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
                }
            } catch (err) {
                console.warn('Fullscreen request failed (often requires user interaction):', err);
            }
        };

        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === 'f') {
                requestFullscreen();
            }
        };

        presenceBroadcaster.announce();
        const heartbeat = window.setInterval(() => {
            presenceBroadcaster.announce();
        }, 1000);

        document.body.classList.add('projector-mode');
        document.addEventListener('keydown', handleKeydown);
        requestFS();

        return () => {
            document.body.classList.remove('projector-mode');
            document.removeEventListener('keydown', handleKeydown);
            window.clearInterval(heartbeat);
            presenceBroadcaster.close();
            receiver.close();
        };
    }, []);

    if (state.type === 'clear') {
        return <div className="projector-view black-bg" onClick={requestFullscreen}></div>;
    }

    return (
        <div className="projector-view" onClick={requestFullscreen}>
            <div className="projector-frame" ref={frameRef}>
                <div
                    className="projector-content"
                    ref={contentRef}
                    style={{
                        ...projectorStyle,
                        justifyContent: getProjectorJustifyContent(state),
                        alignItems: state.slideStyle?.textAlign === 'left' ? 'flex-start' : state.slideStyle?.textAlign === 'right' ? 'flex-end' : 'center',
                    }}
                >
                <div className="projector-text" style={buildProjectorTextStyle(state)}>
                    {state.segments && state.segments.length > 0 ? (
                        state.segments.map((segment) => (
                            <span key={`${state.reference}-${segment.verseNumber}`} className="projector-verse-segment">
                                <span className="projector-verse-number">{segment.verseNumber}</span>
                                <span>{segment.text}</span>
                            </span>
                        ))
                    ) : (
                        state.text
                    )}
                </div>
                {state.reference && state.type !== 'song' && (
                    <div className="projector-reference">{state.reference}</div>
                )}
                </div>
            </div>
        </div>
    );
}
