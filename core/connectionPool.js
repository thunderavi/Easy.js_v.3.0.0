/**
 * Advanced Connection Pool Manager
 * Manages database connections with health checks, auto-scaling, and failover
 */

class ConnectionPool {
  constructor(config = {}) {
    this.config = {
      minConnections: config.minConnections || 5,
      maxConnections: config.maxConnections || 50,
      connectionTimeout: config.connectionTimeout || 10000,
      idleTimeout: config.idleTimeout || 30000,
      healthCheckInterval: config.healthCheckInterval || 60000,
      enableAutoScaling: config.enableAutoScaling !== false,
      enableMonitoring: config.enableMonitoring !== false,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
      ...config
    };

    this.connections = [];
    this.activeConnections = new Set();
    this.waitingQueue = [];
    this.stats = {
      totalCreated: 0,
      totalDestroyed: 0,
      activeCount: 0,
      idleCount: 0,
      waitingCount: 0,
      failedAttempts: 0,
      successfulConnections: 0
    };

    this.healthCheckTimer = null;
    this.initialized = false;
  }

  /**
   * Initialize connection pool
   */
  async init(connectionFactory) {
    this.connectionFactory = connectionFactory;
    
    // Create minimum connections
    const promises = [];
    for (let i = 0; i < this.config.minConnections; i++) {
      promises.push(this.createConnection());
    }

    await Promise.all(promises);
    this.initialized = true;
    this.stats.idleCount = this.connections.length;
    this.startHealthChecks();
    console.log(`[ConnectionPool] Initialized with ${this.config.minConnections} connections`);
  }

  /**
   * Create new connection
   */
  async createConnection(retryCount = 0) {
    try {
      const connection = await this.connectionFactory();
      connection.createdAt = Date.now();
      connection.lastUsed = Date.now();
      connection.healthy = true;
      connection.queryCount = 0;

      this.connections.push(connection);
      this.stats.totalCreated++;
      this.stats.successfulConnections++;
      
      return connection;
    } catch (error) {
      this.stats.failedAttempts++;
      
      if (retryCount < this.config.retryAttempts) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
        return this.createConnection(retryCount + 1);
      }
      
      console.error('[ConnectionPool] Failed to create connection:', error.message);
      throw error;
    }
  }

  /**
   * Get connection from pool
   */
  async getConnection(timeout = null) {
    const waitTimeout = timeout || this.config.connectionTimeout;

    // Return idle connection if available
    const idleConn = this.connections.find(c => 
      !this.activeConnections.has(c) && c.healthy
    );

    if (idleConn) {
      this.activeConnections.add(idleConn);
      idleConn.lastUsed = Date.now();
      this.stats.activeCount++;
      this.stats.idleCount = Math.max(0, this.stats.idleCount - 1);
      return idleConn;
    }

    // Create new connection if under max limit
    if (this.connections.length < this.config.maxConnections) {
      try {
        const newConn = await this.createConnection();
        this.activeConnections.add(newConn);
        this.stats.activeCount++;
        return newConn;
      } catch (error) {
        // Fall through to queue
      }
    }

    // Wait for connection to become available
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, timeout: Date.now() + waitTimeout, timer: null };
      this.waitingQueue.push(request);
      this.stats.waitingCount++;

      // Timeout if connection not available
      request.timer = setTimeout(() => {
        const index = this.waitingQueue.indexOf(request);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
          this.stats.waitingCount--;
          reject(new Error('Connection timeout - no connections available'));
        }
      }, waitTimeout);
    });
  }

  /**
   * Release connection back to pool
   */
  releaseConnection(connection) {
    if (!connection) return;
    if (!this.activeConnections.has(connection)) return;

    this.activeConnections.delete(connection);
    connection.lastUsed = Date.now();
    this.stats.activeCount = Math.max(0, this.stats.activeCount - 1);

    // Serve waiting request
    if (this.waitingQueue.length > 0) {
      const request = this.waitingQueue.shift();
      clearTimeout(request.timer);
      this.stats.waitingCount--;
      this.activeConnections.add(connection);
      this.stats.activeCount++;
      request.resolve(connection);
    } else {
      this.stats.idleCount++;
    }
  }

  /**
   * Perform health check on connections
   */
  async healthCheck() {
    const unhealthy = [];

    for (const conn of this.connections) {
      let healthCheckTimeout = null;

      try {
        // Simple query to test connection
        await Promise.race([
          this.testConnection(conn),
          new Promise((_, reject) => {
            healthCheckTimeout = setTimeout(
              () => reject(new Error('Health check timeout')),
              5000
            );
          })
        ]);
        conn.healthy = true;
      } catch (error) {
        conn.healthy = false;
        unhealthy.push(conn);
      } finally {
        if (healthCheckTimeout) {
          clearTimeout(healthCheckTimeout);
        }
      }
    }

    // Remove unhealthy connections
    for (const conn of unhealthy) {
      this.removeConnection(conn);
    }

    if (unhealthy.length > 0) {
      console.warn(`[ConnectionPool] Removed ${unhealthy.length} unhealthy connections`);
    }

    // Auto-scale if needed
    if (this.config.enableAutoScaling) {
      await this.autoScale();
    }
  }

  /**
   * Test connection health
   */
  async testConnection(connection) {
    // Override in subclass or provide test query
    if (connection.ping) {
      return connection.ping();
    }
    return true;
  }

  /**
   * Auto-scale connections based on demand
   */
  async autoScale() {
    const utilization = this.connections.length === 0
      ? 0
      : this.activeConnections.size / this.connections.length;
    const waitingCount = this.waitingQueue.length;

    // Scale up if utilization is high
    if (utilization > 0.8 && this.connections.length < this.config.maxConnections) {
      const toAdd = Math.min(5, this.config.maxConnections - this.connections.length);
      for (let i = 0; i < toAdd; i++) {
        try {
          await this.createConnection();
        } catch (error) {
          console.error('[ConnectionPool] Auto-scale failed:', error.message);
        }
      }
      console.log(`[ConnectionPool] Scaled up: added ${toAdd} connections`);
    }

    // Scale down if utilization is low
    if (utilization < 0.2 && this.connections.length > this.config.minConnections) {
      const idle = this.connections.filter(c => !this.activeConnections.has(c));
      const toRemove = Math.min(
        Math.ceil(idle.length * 0.5),
        this.connections.length - this.config.minConnections
      );

      for (let i = 0; i < toRemove; i++) {
        if (idle[i]) {
          this.removeConnection(idle[i]);
        }
      }
      console.log(`[ConnectionPool] Scaled down: removed ${toRemove} connections`);
    }
  }

  /**
   * Remove connection from pool
   */
  removeConnection(connection) {
    const index = this.connections.indexOf(connection);
    if (index !== -1) {
      this.connections.splice(index, 1);
      if (this.activeConnections.delete(connection)) {
        this.stats.activeCount = Math.max(0, this.stats.activeCount - 1);
      } else {
        this.stats.idleCount = Math.max(0, this.stats.idleCount - 1);
      }
      this.stats.totalDestroyed++;
      
      try {
        if (connection.close) {
          connection.close();
        }
      } catch (error) {
        console.error('[ConnectionPool] Error closing connection:', error.message);
      }
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    this.healthCheckTimer = setInterval(() => {
      this.healthCheck().catch(err => 
        console.error('[ConnectionPool] Health check error:', err.message)
      );
    }, this.config.healthCheckInterval);
    this.healthCheckTimer.unref?.();
  }

  /**
   * Stop health checks
   */
  stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalConnections: this.connections.length,
      activeConnections: this.activeConnections.size,
      idleConnections: this.connections.length - this.activeConnections.size,
      waitingRequests: this.waitingQueue.length,
      utilizationPercent: (this.connections.length === 0
        ? 0
        : (this.activeConnections.size / this.connections.length) * 100
      ).toFixed(2) + '%',
      avgConnectionAge: this.getAverageConnectionAge()
    };
  }

  /**
   * Calculate average connection age
   */
  getAverageConnectionAge() {
    if (this.connections.length === 0) return 0;
    const totalAge = this.connections.reduce((sum, conn) => 
      sum + (Date.now() - conn.createdAt), 0
    );
    return (totalAge / this.connections.length / 1000).toFixed(2) + 's';
  }

  /**
   * Drain all connections gracefully
   */
  async drain() {
    this.stopHealthChecks();
    
    // Wait for active connections
    let maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeConnections.size > 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Close all connections
    for (const conn of this.connections) {
      try {
        if (conn.close) {
          await conn.close();
        }
      } catch (error) {
        console.error('[ConnectionPool] Error draining connection:', error.message);
      }
    }

    this.connections = [];
    this.activeConnections.clear();
    this.waitingQueue = [];
    this.stats.activeCount = 0;
    this.stats.idleCount = 0;
    this.stats.waitingCount = 0;
    console.log('[ConnectionPool] Drained and closed all connections');
  }
}

module.exports = ConnectionPool;
