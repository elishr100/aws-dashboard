import { WebSocket } from 'ws';

export const chatConnections = new Map<string, WebSocket>();
