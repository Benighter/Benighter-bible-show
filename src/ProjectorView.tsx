import { useEffect, useState } from 'react';
import { createProjectorPresenceBroadcaster, createReceiver, type PresentationState } from './lib/Broadcast';
import './index.css';

export default function ProjectorView() {
    const [state, setState] = useState<PresentationState>({ type: 'clear', text: '' });

    const requestFullscreen = () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);

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
            <div className="projector-content">
                <div className="projector-text">{state.text}</div>
                {state.reference && (
                    <div className="projector-reference">{state.reference}</div>
                )}
            </div>
        </div>
    );
}
