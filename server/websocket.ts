/**
 * Fleet Communication WebSocket Server
 *
 * Handles real-time bidirectional communication for:
 * - Driver presence tracking (online/offline status)
 * - Drop-in commands (dispatcher -> driver)
 * - Call state synchronization
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { db } from './db';
import { eq, and } from 'drizzle-orm';

// Types for WebSocket messages
interface WSMessage {
  type: string;
  payload?: any;
}

interface DriverConnection {
  ws: WebSocket;
  driverId: string;
  driverName: string;
  tenantId: string;
  lastSeen: Date;
  deviceInfo?: {
    userAgent?: string;
    platform?: string;
  };
}

interface DispatchConnection {
  ws: WebSocket;
  userId: string;
  tenantId: string;
  username: string;
}

// Connection stores
const driverConnections = new Map<string, DriverConnection>();
const dispatchConnections = new Map<string, DispatchConnection>();

// Active drop-in sessions
const activeDropIns = new Map<string, {
  roomName: string;
  driverId: string;
  dispatcherId: string;
  startedAt: Date;
}>();

/**
 * Initialize WebSocket server on the HTTP server
 */
export function initWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/ws/fleet-comm'
  });

  console.log('[WebSocket] Fleet communication server initialized on /api/ws/fleet-comm');

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type'); // 'driver' or 'dispatch'
    const clientId = url.searchParams.get('id');
    const tenantId = url.searchParams.get('tenantId');
    const name = url.searchParams.get('name') || 'Unknown';

    console.log(`[WebSocket] New ${clientType} connection: ${name} (${clientId})`);

    if (clientType === 'driver' && clientId && tenantId) {
      handleDriverConnection(ws, clientId, name, tenantId, req.headers['user-agent']);
    } else if (clientType === 'dispatch' && clientId && tenantId) {
      handleDispatchConnection(ws, clientId, name, tenantId);
    } else {
      console.log('[WebSocket] Invalid connection parameters, closing');
      ws.close(4000, 'Missing required parameters');
    }
  });

  // Heartbeat interval to detect stale connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        return ws.terminate();
      }
      (ws as any).isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

/**
 * Handle driver WebSocket connection
 */
function handleDriverConnection(
  ws: WebSocket,
  driverId: string,
  driverName: string,
  tenantId: string,
  userAgent?: string
) {
  // Store connection
  driverConnections.set(driverId, {
    ws,
    driverId,
    driverName,
    tenantId,
    lastSeen: new Date(),
    deviceInfo: { userAgent }
  });

  // Mark as alive for heartbeat
  (ws as any).isAlive = true;
  ws.on('pong', () => {
    (ws as any).isAlive = true;
    const conn = driverConnections.get(driverId);
    if (conn) {
      conn.lastSeen = new Date();
    }
  });

  // Notify all dispatchers that driver is online
  broadcastToDispatchers(tenantId, {
    type: 'driver_online',
    payload: {
      driverId,
      driverName,
      timestamp: new Date().toISOString()
    }
  });

  // Handle messages from driver
  ws.on('message', (data) => {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      handleDriverMessage(driverId, tenantId, message);
    } catch (err) {
      console.error('[WebSocket] Error parsing driver message:', err);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log(`[WebSocket] Driver disconnected: ${driverName} (${driverId})`);
    driverConnections.delete(driverId);

    // Notify dispatchers
    broadcastToDispatchers(tenantId, {
      type: 'driver_offline',
      payload: {
        driverId,
        driverName,
        timestamp: new Date().toISOString()
      }
    });

    // End any active drop-in with this driver
    const activeDropIn = activeDropIns.get(driverId);
    if (activeDropIn) {
      endDropInSession(driverId);
    }
  });

  // Send welcome message
  sendToDriver(driverId, {
    type: 'connected',
    payload: {
      message: 'Connected to Fleet Communication',
      driverId,
      driverName
    }
  });
}

/**
 * Handle dispatch WebSocket connection
 */
function handleDispatchConnection(
  ws: WebSocket,
  userId: string,
  username: string,
  tenantId: string
) {
  // Store connection
  dispatchConnections.set(userId, {
    ws,
    userId,
    username,
    tenantId
  });

  // Mark as alive for heartbeat
  (ws as any).isAlive = true;
  ws.on('pong', () => {
    (ws as any).isAlive = true;
  });

  // Handle messages from dispatcher
  ws.on('message', (data) => {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      handleDispatchMessage(userId, tenantId, message);
    } catch (err) {
      console.error('[WebSocket] Error parsing dispatch message:', err);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log(`[WebSocket] Dispatcher disconnected: ${username} (${userId})`);
    dispatchConnections.delete(userId);
  });

  // Send current driver presence list
  const onlineDrivers = Array.from(driverConnections.values())
    .filter(d => d.tenantId === tenantId)
    .map(d => ({
      driverId: d.driverId,
      driverName: d.driverName,
      lastSeen: d.lastSeen.toISOString(),
      deviceInfo: d.deviceInfo
    }));

  sendToDispatcher(userId, {
    type: 'connected',
    payload: {
      message: 'Connected to Fleet Communication',
      onlineDrivers
    }
  });
}

/**
 * Handle messages from driver
 */
function handleDriverMessage(driverId: string, tenantId: string, message: WSMessage) {
  switch (message.type) {
    case 'heartbeat':
      // Update last seen
      const conn = driverConnections.get(driverId);
      if (conn) {
        conn.lastSeen = new Date();
      }
      break;

    case 'drop_in_joined':
      // Driver successfully joined Jitsi room
      broadcastToDispatchers(tenantId, {
        type: 'drop_in_joined',
        payload: {
          driverId,
          roomName: message.payload?.roomName,
          timestamp: new Date().toISOString()
        }
      });
      break;

    case 'drop_in_left':
      // Driver left the Jitsi room
      endDropInSession(driverId);
      break;

    default:
      console.log(`[WebSocket] Unknown driver message type: ${message.type}`);
  }
}

/**
 * Handle messages from dispatcher
 */
function handleDispatchMessage(userId: string, tenantId: string, message: WSMessage) {
  switch (message.type) {
    case 'start_drop_in':
      // Dispatcher wants to drop in on a driver
      const { driverId, driverName } = message.payload;
      startDropInSession(userId, driverId, driverName, tenantId);
      break;

    case 'end_drop_in':
      // Dispatcher ending a drop-in call
      endDropInSession(message.payload.driverId);
      break;

    case 'request_presence':
      // Dispatcher requesting current presence list
      const onlineDrivers = Array.from(driverConnections.values())
        .filter(d => d.tenantId === tenantId)
        .map(d => ({
          driverId: d.driverId,
          driverName: d.driverName,
          lastSeen: d.lastSeen.toISOString()
        }));

      sendToDispatcher(userId, {
        type: 'presence_update',
        payload: { onlineDrivers }
      });
      break;

    default:
      console.log(`[WebSocket] Unknown dispatch message type: ${message.type}`);
  }
}

/**
 * Start a drop-in session
 */
function startDropInSession(
  dispatcherId: string,
  driverId: string,
  driverName: string,
  tenantId: string
) {
  // Generate unique room name
  const roomName = `freedom-${driverId}-${Date.now()}`;

  // Store active session
  activeDropIns.set(driverId, {
    roomName,
    driverId,
    dispatcherId,
    startedAt: new Date()
  });

  // Send command to driver to join room
  const sent = sendToDriver(driverId, {
    type: 'join_drop_in',
    payload: {
      roomName,
      dispatcherName: getDispatcherName(dispatcherId)
    }
  });

  if (sent) {
    // Notify dispatcher that command was sent
    sendToDispatcher(dispatcherId, {
      type: 'drop_in_started',
      payload: {
        roomName,
        driverId,
        driverName,
        timestamp: new Date().toISOString()
      }
    });

    console.log(`[WebSocket] Drop-in started: ${dispatcherId} -> ${driverId} in room ${roomName}`);
  } else {
    // Driver not connected
    sendToDispatcher(dispatcherId, {
      type: 'drop_in_failed',
      payload: {
        driverId,
        reason: 'Driver is offline',
        timestamp: new Date().toISOString()
      }
    });
  }
}

/**
 * End a drop-in session
 */
function endDropInSession(driverId: string) {
  const session = activeDropIns.get(driverId);
  if (!session) return;

  const duration = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);

  // Notify driver to leave room
  sendToDriver(driverId, {
    type: 'leave_drop_in',
    payload: { roomName: session.roomName }
  });

  // Notify dispatcher
  sendToDispatcher(session.dispatcherId, {
    type: 'drop_in_ended',
    payload: {
      driverId,
      roomName: session.roomName,
      duration,
      timestamp: new Date().toISOString()
    }
  });

  // Remove from active sessions
  activeDropIns.delete(driverId);

  console.log(`[WebSocket] Drop-in ended: ${driverId}, duration: ${duration}s`);
}

/**
 * Send message to a specific driver
 */
function sendToDriver(driverId: string, message: WSMessage): boolean {
  const conn = driverConnections.get(driverId);
  if (conn && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Send message to a specific dispatcher
 */
function sendToDispatcher(userId: string, message: WSMessage): boolean {
  const conn = dispatchConnections.get(userId);
  if (conn && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Broadcast message to all dispatchers of a tenant
 */
function broadcastToDispatchers(tenantId: string, message: WSMessage) {
  dispatchConnections.forEach((conn) => {
    if (conn.tenantId === tenantId && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(message));
    }
  });
}

/**
 * Get dispatcher name by ID
 */
function getDispatcherName(dispatcherId: string): string {
  const conn = dispatchConnections.get(dispatcherId);
  return conn?.username || 'Dispatch';
}

/**
 * Get online drivers for a tenant (for REST API fallback)
 */
export function getOnlineDrivers(tenantId: string) {
  return Array.from(driverConnections.values())
    .filter(d => d.tenantId === tenantId)
    .map(d => ({
      driverId: d.driverId,
      driverName: d.driverName,
      lastSeen: d.lastSeen.toISOString(),
      isOnline: true
    }));
}

/**
 * Check if a specific driver is online
 */
export function isDriverOnline(driverId: string): boolean {
  return driverConnections.has(driverId);
}

/**
 * Get active drop-in sessions
 */
export function getActiveDropIns() {
  return Array.from(activeDropIns.entries()).map(([driverId, session]) => ({
    driverId,
    roomName: session.roomName,
    dispatcherId: session.dispatcherId,
    startedAt: session.startedAt.toISOString(),
    duration: Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
  }));
}
