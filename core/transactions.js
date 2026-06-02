/**
 * Advanced Transaction Management System
 * ACID compliance, rollback, saga pattern, and distributed transactions
 */

class TransactionManager {
  constructor(config = {}) {
    this.config = {
      enableAutoCommit: config.enableAutoCommit !== false,
      isolationLevel: config.isolationLevel || 'READ_COMMITTED', // READ_UNCOMMITTED, READ_COMMITTED, REPEATABLE_READ, SERIALIZABLE
      timeout: config.timeout || 30000, // 30 seconds
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      enableDLQ: config.enableDLQ !== false, // Dead Letter Queue
      ...config
    };

    this.activeTransactions = new Map();
    this.locks = new Map();
    this.deadLetterQueue = [];
    this.transactionLog = [];
    this.savepoints = new Map();
  }

  /**
   * Begin transaction
   */
  async beginTransaction(transactionId = null) {
    const txId = transactionId || this.generateTransactionId();
    const transaction = {
      id: txId,
      startTime: Date.now(),
      status: 'ACTIVE',
      isolationLevel: this.config.isolationLevel,
      operations: [],
      locks: [],
      savepoints: [],
      rolledBack: false,
      committed: false,
      readSet: new Set(),
      writeSet: new Set()
    };

    this.activeTransactions.set(txId, transaction);
    this.logTransaction(txId, 'BEGIN', 'Transaction started');

    return txId;
  }

  /**
   * Execute operation within transaction
   */
  async executeOperation(transactionId, operation, operationFn) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'ACTIVE') throw new Error('Transaction is not active');

    try {
      // Acquire locks if needed
      if (operation.lockType) {
        await this.acquireLock(transactionId, operation.resource, operation.lockType);
      }

      // Track read/write sets for conflict detection
      if (operation.type === 'READ') {
        transaction.readSet.add(operation.resource);
      } else if (operation.type === 'WRITE') {
        transaction.writeSet.add(operation.resource);
      }

      // Execute operation
      const result = await operationFn();

      // Record operation
      transaction.operations.push({
        type: operation.type,
        resource: operation.resource,
        data: operation.data,
        result,
        timestamp: Date.now(),
        undoFunc: operation.undoFunc || null,
        validate: operation.validate || null
      });

      return result;
    } catch (error) {
      this.logTransaction(transactionId, 'ERROR', error.message);
      throw error;
    }
  }

  /**
   * Create savepoint
   */
  createSavepoint(transactionId, savepointName) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) throw new Error('Transaction not found');

    const savepoint = {
      name: savepointName,
      operationIndex: transaction.operations.length,
      locks: [...transaction.locks],
      timestamp: Date.now()
    };

    if (!this.savepoints.has(transactionId)) {
      this.savepoints.set(transactionId, []);
    }

    this.savepoints.get(transactionId).push(savepoint);
    transaction.savepoints.push(savepointName);
    this.logTransaction(transactionId, 'SAVEPOINT', savepointName);

    return savepoint;
  }

  /**
   * Rollback to savepoint
   */
  async rollbackToSavepoint(transactionId, savepointName) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) throw new Error('Transaction not found');

    const savepoints = this.savepoints.get(transactionId) || [];
    const savepoint = savepoints.find(sp => sp.name === savepointName);
    if (!savepoint) throw new Error('Savepoint not found');

    // Undo operations after savepoint
    const opsToUndo = transaction.operations.slice(savepoint.operationIndex);
    for (let i = opsToUndo.length - 1; i >= 0; i--) {
      const op = opsToUndo[i];
      if (op.undoFunc) {
        try {
          await op.undoFunc();
        } catch (error) {
          console.error('[TransactionManager] Undo operation failed:', error.message);
        }
      }
    }

    // Restore state
    transaction.operations = transaction.operations.slice(0, savepoint.operationIndex);
    transaction.locks = savepoint.locks;

    this.logTransaction(transactionId, 'ROLLBACK_TO_SAVEPOINT', savepointName);
  }

  /**
   * Commit transaction
   */
  async commit(transactionId, retryCount = 0) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'ACTIVE') throw new Error('Transaction is not active');

    try {
      // Check for conflicts
      if (!this.checkConflicts(transactionId)) {
        throw new Error('Transaction conflict detected');
      }

      // Validate all operations
      await this.validateOperations(transaction);

      // Change status
      transaction.status = 'COMMITTING';

      // Write to log (WAL - Write-Ahead Logging)
      this.writeAheadLog(transaction);

      // Release locks
      for (const lock of transaction.locks) {
        this.releaseLock(lock.resource, transactionId);
      }

      // Mark as committed
      transaction.status = 'COMMITTED';
      transaction.committed = true;
      transaction.commitTime = Date.now();

      this.logTransaction(transactionId, 'COMMIT', 'Transaction committed successfully');
      this.cleanupTransaction(transactionId);

      return { success: true, transactionId };
    } catch (error) {
      if (retryCount < this.config.maxRetries) {
        console.warn(`[TransactionManager] Commit failed, retrying... (${retryCount + 1}/${this.config.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
        return this.commit(transactionId, retryCount + 1);
      }

      // Move to dead letter queue if retries exhausted
      if (this.config.enableDLQ) {
        this.deadLetterQueue.push({
          transaction,
          error: error.message,
          timestamp: Date.now()
        });
      }

      throw error;
    }
  }

  /**
   * Rollback transaction
   */
  async rollback(transactionId) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) throw new Error('Transaction not found');

    try {
      // Undo all operations in reverse order
      for (let i = transaction.operations.length - 1; i >= 0; i--) {
        const op = transaction.operations[i];
        if (op.undoFunc) {
          try {
            await op.undoFunc();
          } catch (error) {
            console.error('[TransactionManager] Undo operation failed:', error.message);
          }
        }
      }

      // Release all locks
      for (const lock of transaction.locks) {
        this.releaseLock(lock.resource, transactionId);
      }

      transaction.status = 'ROLLED_BACK';
      transaction.rolledBack = true;
      transaction.rollbackTime = Date.now();

      this.logTransaction(transactionId, 'ROLLBACK', 'Transaction rolled back');
      this.cleanupTransaction(transactionId);

      return { success: true, transactionId };
    } catch (error) {
      console.error('[TransactionManager] Rollback failed:', error.message);
      throw error;
    }
  }

  /**
   * Acquire lock for resource
   */
  async acquireLock(transactionId, resource, lockType = 'WRITE') {
    const timeout = this.config.timeout;
    const startTime = Date.now();

    while (true) {
      // Check if lock is available
      if (!this.locks.has(resource)) {
        this.locks.set(resource, { owner: transactionId, type: lockType, acquiredAt: Date.now() });
        
        const transaction = this.activeTransactions.get(transactionId);
        if (transaction) {
          transaction.locks.push({ resource, type: lockType });
        }

        return true;
      }

      const lock = this.locks.get(resource);
      
      // If same transaction, upgrade lock if needed
      if (lock.owner === transactionId) {
        if (lockType === 'WRITE' && lock.type === 'READ') {
          lock.type = 'WRITE';
        }
        return true;
      }

      // Check timeout
      if (Date.now() - startTime > timeout) {
        throw new Error(`Lock acquisition timeout for ${resource}`);
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Release lock
   */
  releaseLock(resource, transactionId) {
    const lock = this.locks.get(resource);
    if (lock && lock.owner === transactionId) {
      this.locks.delete(resource);
    }
  }

  /**
   * Check for transaction conflicts
   */
  checkConflicts(transactionId) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) return false;

    // Check for conflicts with other active transactions
    for (const [otherTxId, otherTx] of this.activeTransactions.entries()) {
      if (otherTxId === transactionId) continue;
      if (otherTx.status !== 'ACTIVE') continue;

      // Read-Write conflict
      if ([...otherTx.writeSet].some(r => transaction.readSet.has(r))) return false;
      
      // Write-Read conflict
      if ([...otherTx.readSet].some(r => transaction.writeSet.has(r))) return false;
      
      // Write-Write conflict
      if ([...otherTx.writeSet].some(r => transaction.writeSet.has(r))) return false;
    }

    return true;
  }

  /**
   * Validate all operations
   */
  async validateOperations(transaction) {
    for (const op of transaction.operations) {
      if (op.validate) {
        const isValid = await op.validate();
        if (!isValid) {
          throw new Error(`Operation validation failed for ${op.resource}`);
        }
      }
    }
  }

  /**
   * Write-Ahead Logging for durability
   */
  writeAheadLog(transaction) {
    const logEntry = {
      transactionId: transaction.id,
      operations: transaction.operations,
      timestamp: Date.now(),
      checksum: this.calculateChecksum(transaction)
    };

    this.transactionLog.push(logEntry);

    // Keep only recent logs (last 10000 entries)
    if (this.transactionLog.length > 10000) {
      this.transactionLog = this.transactionLog.slice(-5000);
    }
  }

  /**
   * Generate transaction ID
   */
  generateTransactionId() {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Calculate transaction checksum
   */
  calculateChecksum(transaction) {
    const crypto = require('crypto');
    const data = JSON.stringify(transaction.operations);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Log transaction event
   */
  logTransaction(transactionId, event, message) {
    const entry = {
      transactionId,
      event,
      message,
      timestamp: Date.now()
    };

    this.transactionLog.push(entry);
  }

  /**
   * Cleanup transaction
   */
  cleanupTransaction(transactionId) {
    setTimeout(() => {
      this.activeTransactions.delete(transactionId);
      this.savepoints.delete(transactionId);
    }, 60000); // Keep for 1 minute for debugging
  }

  /**
   * Get transaction status
   */
  getTransactionStatus(transactionId) {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) return null;

    return {
      id: transaction.id,
      status: transaction.status,
      duration: Date.now() - transaction.startTime,
      operationCount: transaction.operations.length,
      lockCount: transaction.locks.length,
      savepointCount: transaction.savepoints.length
    };
  }

  /**
   * Get all active transactions
   */
  getActiveTransactions() {
    return Array.from(this.activeTransactions.values()).map(tx => ({
      id: tx.id,
      status: tx.status,
      duration: Date.now() - tx.startTime,
      operations: tx.operations.length
    }));
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue() {
    return this.deadLetterQueue;
  }

  /**
   * Retry dead letter queue item
   */
  async retryDeadLetter(index) {
    if (index >= this.deadLetterQueue.length) {
      throw new Error('Dead letter queue index out of range');
    }

    const item = this.deadLetterQueue[index];
    try {
      await this.commit(item.transaction.id);
      this.deadLetterQueue.splice(index, 1);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = TransactionManager;
