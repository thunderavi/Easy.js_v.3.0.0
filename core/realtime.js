/**
 * Real-time Engine
 * WebSocket support, pub/sub, and live data streaming
 */

const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const { validateJwtSecret } = require('./jwtSecretValidator');

class RealtimeEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      enableWebSocket: config.enableWebSocket !== false,
      enablePubSub: config.enablePubSub !== false,
      enableStreaming: config.enableStreaming !== false,
      maxConnections: config.maxConnections || 10000,
      heartbeatInterval: config.heartbeatInterval || 30000,
      messageQueueSize: config.messageQueueSize || 1000,
      jwtSecret: validateJwtSecret(
        config.jwtSecret || process.env.JWT_SECRET,
        'JWT_SECRET (RealtimeEngine)'
      ),
      ...config
    };

    this.authManager = config.authManager || null;
    this.connections = new Map();
    this.channels = new Map();
    this.messageQueue = [];
    this.subscribers = new Map();
    this.presenceData = new Map();
    this.streams = new Map();
    this.connectedAt = new Map();
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    const connection = {
      id: clientId,
      ws,
      userId: req.user?.id || null,
      connectedAt: Date.now(),
      subscriptions: new Set(),
      lastHeartbeat: Date.now(),
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0
    };

    this.connections.set(clientId, connection);
    this.connectedAt.set(clientId, Date.now());

    // Setup message handler
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', () => this.handleDisconnection(clientId));
    ws.on('error', (error) => this.handleError(clientId, error));

    // Send welcome message
    this.sendMessage(clientId, {
      type: 'connected',
      clientId,
      timestamp: Date.now()
    });

    console.log(`[RealtimeEngine] Client ${clientId} connected (Total: ${this.connections.size})`);
    this.emit('client:connected', { clientId, userId: connection.userId });
  }

  /**
   * Handle incoming message
   */
  handleMessage(clientId, data) {
    const connection = this.connections.get(clientId);
    if (!connection) return;

    try {
      const message = JSON.parse(data.toString());
      connection.messageCount++;
      connection.bytesReceived += data.length;

      // Route message based on type
      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(clientId, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message);
          break;
        case 'publish':
          this.handlePublish(clientId, message);
          break;
        case 'ping':
          this.handlePing(clientId);
          break;
        case 'auth':
          this.handleAuth(clientId, message);
          break;
        case 'presence':
          this.handlePresence(clientId, message);
          break;
        default:
          this.emit('message', { clientId, message });
      }
    } catch (error) {
      console.error(`[RealtimeEngine] Message parse error:`, error.message);
      this.sendMessage(clientId, { type: 'error', message: 'Invalid message format' });
    }
  }

  /**
   * Handle subscription to channel
   */
  handleSubscribe(clientId, message) {
    const { channel } = message;
    if (!channel) return;

    const connection = this.connections.get(clientId);
    if (!connection) return;

    connection.subscriptions.add(channel);

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }

    this.channels.get(channel).add(clientId);

    // Send subscription confirmation
    this.sendMessage(clientId, {
      type: 'subscribed',
      channel,
      subscribers: this.channels.get(channel).size
    });

    console.log(`[RealtimeEngine] Client ${clientId} subscribed to ${channel}`);
  }

  /**
   * Handle unsubscription from channel
   */
  handleUnsubscribe(clientId, message) {
    const { channel } = message;
    if (!channel) return;

    const connection = this.connections.get(clientId);
    if (!connection) return;

    connection.subscriptions.delete(channel);
    
    const channelSubs = this.channels.get(channel);
    if (channelSubs) {
      channelSubs.delete(clientId);
      if (channelSubs.size === 0) {
        this.channels.delete(channel);
      }
    }

    this.sendMessage(clientId, {
      type: 'unsubscribed',
      channel
    });
  }

  /**
   * Handle publish to channel
   */
  handlePublish(clientId, message) {
    const { channel, data } = message;
    if (!channel || !data) return;

    // Broadcast to all subscribers
    this.broadcastToChannel(channel, {
      type: 'message',
      channel,
      data,
      from: clientId,
      timestamp: Date.now()
    });

    this.emit('publish', { clientId, channel, data });
  }

  /**
   * Handle ping/heartbeat
   */
  handlePing(clientId) {
    const connection = this.connections.get(clientId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
      this.sendMessage(clientId, { type: 'pong', timestamp: Date.now() });
    }
  }

  /**
   * Handle authentication
   */
  handleAuth(clientId, message) {
    const { token } = message;
    const connection = this.connections.get(clientId);
    if (!connection) return;

    try {
      if (!token || typeof token !== 'string') {
        throw new Error('Missing token');
      }

      const decoded = this.verifyAuthToken(token);
      connection.userId = decoded.userId || decoded.id || decoded.sub || null;
      connection.user = decoded;
      connection.authenticated = true;

      this.sendMessage(clientId, {
        type: 'authenticated',
        success: true,
        userId: connection.userId
      });
      this.emit('client:authenticated', { clientId, userId: connection.userId, user: decoded });
    } catch (error) {
      connection.authenticated = false;
      this.sendMessage(clientId, {
        type: 'authenticated',
        success: false,
        error: 'Authentication failed'
      });
    }
  }

  verifyAuthToken(token) {
    if (this.authManager && typeof this.authManager.verifyToken === 'function') {
      return this.authManager.verifyToken(token);
    }

    return jwt.verify(token, this.config.jwtSecret);
  }

  /**
   * Handle presence updates
   */
  handlePresence(clientId, message) {
    const { action, status } = message;
    const connection = this.connections.get(clientId);
    if (!connection) return;

    if (action === 'update') {
      this.presenceData.set(clientId, {
        clientId,
        userId: connection.userId,
        status,
        lastUpdate: Date.now()
      });

      // Broadcast presence to all subscribers
      this.broadcastPresence();
    }
  }

  /**
   * Handle disconnection
   */
  handleDisconnection(clientId) {
    const connection = this.connections.get(clientId);
    if (!connection) return;

    // Unsubscribe from all channels
    for (const channel of connection.subscriptions) {
      const channelSubs = this.channels.get(channel);
      if (channelSubs) {
        channelSubs.delete(clientId);
      }
    }

    // Remove presence
    this.presenceData.delete(clientId);

    // Remove connection
    this.connections.delete(clientId);
    this.connectedAt.delete(clientId);

    console.log(`[RealtimeEngine] Client ${clientId} disconnected (Total: ${this.connections.size})`);
    this.emit('client:disconnected', { clientId });
  }

  /**
   * Handle connection error
   */
  handleError(clientId, error) {
    console.error(`[RealtimeEngine] Connection error for ${clientId}:`, error.message);
    this.emit('error', { clientId, error });
  }

  /**
   * Send message to client
   */
  sendMessage(clientId, message) {
    const connection = this.connections.get(clientId);
    if (!connection || connection.ws.readyState !== 1) return; // 1 = OPEN

    try {
      connection.ws.send(JSON.stringify(message));
      connection.bytesSent += JSON.stringify(message).length;
    } catch (error) {
      console.error(`[RealtimeEngine] Send message error:`, error.message);
    }
  }

  /**
   * Broadcast message to channel subscribers
   */
  broadcastToChannel(channel, message) {
    const subscribers = this.channels.get(channel);
    if (!subscribers) return;

    for (const clientId of subscribers) {
      this.sendMessage(clientId, message);
    }
  }

  /**
   * Broadcast presence to all connected clients
   */
  broadcastPresence() {
    const presence = Array.from(this.presenceData.values());
    const message = {
      type: 'presence_update',
      presence,
      timestamp: Date.now()
    };

    for (const clientId of this.connections.keys()) {
      this.sendMessage(clientId, message);
    }
  }

  /**
   * Start streaming data
   */
  startStream(clientId, streamId, dataSource) {
    const stream = {
      id: streamId,
      clientId,
      dataSource,
      started: Date.now(),
      paused: false,
      bytesStreamed: 0,
      chunks: 0
    };

    this.streams.set(streamId, stream);

    // Start streaming
    this.streamData(streamId);
  }

  /**
   * Stream data chunks
   */
  async streamData(streamId) {
    const stream = this.streams.get(streamId);
    if (!stream) return;

    try {
      while (!stream.paused && this.streams.has(streamId)) {
        const data = await stream.dataSource.getChunk();
        
        if (!data) break;

        this.sendMessage(stream.clientId, {
          type: 'stream_data',
          streamId,
          data,
          chunk: stream.chunks++
        });

        stream.bytesStreamed += JSON.stringify(data).length;

        // Small delay to avoid overwhelming client
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      this.streams.delete(streamId);
      this.sendMessage(stream.clientId, {
        type: 'stream_complete',
        streamId
      });
    } catch (error) {
      this.sendMessage(stream.clientId, {
        type: 'stream_error',
        streamId,
        error: error.message
      });
    }
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const connections = Array.from(this.connections.values());
    const totalBytes = connections.reduce((sum, c) => sum + c.bytesSent + c.bytesReceived, 0);
    const avgConnectionTime = connections.length > 0
      ? connections.reduce((sum, c) => sum + (Date.now() - c.connectedAt), 0) / connections.length
      : 0;

    return {
      connectedClients: this.connections.size,
      activeChannels: this.channels.size,
      totalChannelSubscriptions: Array.from(this.channels.values()).reduce((sum, subs) => sum + subs.size, 0),
      activeStreams: this.streams.size,
      totalMessagesSent: connections.reduce((sum, c) => sum + c.messageCount, 0),
      totalBytesSent: connections.reduce((sum, c) => sum + c.bytesSent, 0),
      totalBytesReceived: connections.reduce((sum, c) => sum + c.bytesReceived, 0),
      avgConnectionDurationMs: avgConnectionTime
    };
  }

  /**
   * Close all connections
   */
  closeAll() {
    for (const [clientId, connection] of this.connections.entries()) {
      try {
        connection.ws.close(1000, 'Server shutting down');
      } catch (error) {
        console.error(`[RealtimeEngine] Error closing connection ${clientId}:`, error.message);
      }
    }

    this.connections.clear();
    this.channels.clear();
    this.streams.clear();
    console.log('[RealtimeEngine] All connections closed');
  }
}

module.exports = RealtimeEngine;
