export interface VerseSegment {
    verseNumber: number;
    text: string;
}

export type SlideTextAlign = 'left' | 'center' | 'right';
export type SlideVerticalAlign = 'top' | 'middle' | 'bottom';

export interface SlideTextStyle {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    textAlign?: SlideTextAlign;
    verticalAlign?: SlideVerticalAlign;
    offsetX?: number;
    offsetY?: number;
    lineHeight?: number;
}

export interface PresentationState {
    type: 'verse' | 'song' | 'clear' | 'blank' | 'logo';
    text: string;
    reference?: string;
    background?: string;
    segments?: VerseSegment[];
    slideStyle?: SlideTextStyle;
}

type ChannelMessage =
    | { kind: 'state'; payload: PresentationState }
    | { kind: 'projector-ready' };

export const CHANNEL_NAME = 'bible-show-channel';

export function createSender() {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    return {
        send: (state: PresentationState) => {
            channel.postMessage({ kind: 'state', payload: state } satisfies ChannelMessage);
        },
        close: () => channel.close()
    };
}

export function createReceiver(onReceive: (state: PresentationState) => void) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
        const message = event.data as ChannelMessage | PresentationState;

        if ('kind' in message) {
            if (message.kind === 'state') {
                onReceive(message.payload);
            }
            return;
        }

        onReceive(message);
    };
    return {
        close: () => channel.close()
    };
}

export function createProjectorPresenceListener(onProjectorReady: () => void) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
        const message = event.data as ChannelMessage | PresentationState;
        if (typeof message === 'object' && message && 'kind' in message && message.kind === 'projector-ready') {
            onProjectorReady();
        }
    };

    return {
        close: () => channel.close(),
    };
}

export function createProjectorPresenceBroadcaster() {
    const channel = new BroadcastChannel(CHANNEL_NAME);

    return {
        announce: () => channel.postMessage({ kind: 'projector-ready' } satisfies ChannelMessage),
        close: () => channel.close(),
    };
}
