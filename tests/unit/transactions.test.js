const TransactionManager = require('../../core/transactions');

describe('TransactionManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('begins, executes, savepoints, rolls back to savepoints, and commits transactions', async () => {
    const manager = new TransactionManager({ retryDelay: 1 });
    const tx = await manager.beginTransaction('tx-1');
    const undo = jest.fn();

    await expect(manager.executeOperation(tx, {
      type: 'WRITE',
      resource: 'posts:1',
      lockType: 'WRITE',
      data: { title: 'First' },
      undoFunc: undo
    }, async () => ({ id: 1 }))).resolves.toEqual({ id: 1 });

    manager.createSavepoint(tx, 'after-first');
    await manager.executeOperation(tx, {
      type: 'WRITE',
      resource: 'posts:2',
      data: { title: 'Second' },
      undoFunc: undo
    }, async () => ({ id: 2 }));

    await manager.rollbackToSavepoint(tx, 'after-first');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(manager.getTransactionStatus(tx)).toEqual(expect.objectContaining({
      id: 'tx-1',
      status: 'ACTIVE',
      operationCount: 1
    }));

    await expect(manager.commit(tx)).resolves.toEqual({ success: true, transactionId: 'tx-1' });
    expect(manager.transactionLog.some(entry => entry.event === 'COMMIT')).toBe(true);
  });

  it('rolls back operations in reverse order and releases locks', async () => {
    const manager = new TransactionManager();
    const tx = await manager.beginTransaction('tx-rollback');
    const calls = [];

    await manager.executeOperation(tx, {
      type: 'WRITE',
      resource: 'one',
      lockType: 'WRITE',
      undoFunc: async () => calls.push('one')
    }, async () => 'one');
    await manager.executeOperation(tx, {
      type: 'WRITE',
      resource: 'two',
      lockType: 'WRITE',
      undoFunc: async () => calls.push('two')
    }, async () => 'two');

    await expect(manager.rollback(tx)).resolves.toEqual({
      success: true,
      transactionId: 'tx-rollback'
    });
    expect(calls).toEqual(['two', 'one']);
    expect(manager.locks.size).toBe(0);
  });

  it('validates operations and writes failed commits to the dead letter queue', async () => {
    const manager = new TransactionManager({ maxRetries: 0 });
    const tx = await manager.beginTransaction('tx-invalid');
    await manager.executeOperation(tx, {
      type: 'WRITE',
      resource: 'bad',
      validate: async () => false
    }, async () => 'bad');

    await expect(manager.commit(tx)).rejects.toThrow('Operation validation failed for bad');
    expect(manager.getDeadLetterQueue()).toHaveLength(1);
  });

  it('reports active transactions and errors for missing transactions/savepoints', async () => {
    const manager = new TransactionManager();
    await manager.beginTransaction('tx-active');

    expect(manager.getActiveTransactions()[0]).toEqual(expect.objectContaining({
      id: 'tx-active',
      status: 'ACTIVE'
    }));
    await expect(manager.executeOperation('missing', {}, jest.fn())).rejects.toThrow('Transaction not found');
    expect(() => manager.createSavepoint('missing', 'sp')).toThrow('Transaction not found');
    await expect(manager.rollbackToSavepoint('tx-active', 'missing')).rejects.toThrow('Savepoint not found');
    expect(manager.getTransactionStatus('missing')).toBeNull();
    await expect(manager.retryDeadLetter(99)).rejects.toThrow('Dead letter queue index out of range');
  });

  it('rejects inactive transactions, logs operation errors, and reports rollback failures', async () => {
    const manager = new TransactionManager({ maxRetries: 0 });
    const tx = await manager.beginTransaction('tx-errors');
    manager.activeTransactions.get(tx).status = 'COMMITTED';

    await expect(manager.executeOperation(tx, {}, jest.fn())).rejects.toThrow('Transaction is not active');
    await expect(manager.commit(tx)).rejects.toThrow('Transaction is not active');

    const active = await manager.beginTransaction('tx-active-errors');
    await expect(manager.executeOperation(active, { type: 'READ', resource: 'users' }, async () => {
      throw new Error('operation failed');
    })).rejects.toThrow('operation failed');
    expect(manager.transactionLog).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionId: active, event: 'ERROR', message: 'operation failed' })
    ]));

    const rollbackTx = await manager.beginTransaction('tx-rollback-fail');
    manager.activeTransactions.get(rollbackTx).operations.push({
      undoFunc: () => {
        throw new Error('undo failed');
      }
    });
    await expect(manager.rollback(rollbackTx)).resolves.toEqual({ success: true, transactionId: rollbackTx });

    const missing = new TransactionManager();
    await expect(missing.commit('missing')).rejects.toThrow('Transaction not found');
    await expect(missing.rollback('missing')).rejects.toThrow('Transaction not found');
  });

  it('handles lock upgrade, release ownership, timeout, log trimming, cleanup, and DLQ retry', async () => {
    jest.useRealTimers();
    const manager = new TransactionManager({ timeout: 1, retryDelay: 1, maxRetries: 0 });
    const tx = await manager.beginTransaction('tx-locks');

    await expect(manager.acquireLock(tx, 'resource', 'READ')).resolves.toBe(true);
    await expect(manager.acquireLock(tx, 'resource', 'WRITE')).resolves.toBe(true);
    expect(manager.locks.get('resource').type).toBe('WRITE');
    manager.releaseLock('resource', 'someone-else');
    expect(manager.locks.has('resource')).toBe(true);
    manager.releaseLock('resource', tx);
    expect(manager.locks.has('resource')).toBe(false);

    await manager.acquireLock('other-tx', 'busy', 'WRITE');
    await expect(manager.acquireLock(tx, 'busy', 'WRITE')).rejects.toThrow('Lock acquisition timeout for busy');

    manager.transactionLog = Array.from({ length: 10001 }, (_, index) => ({ index }));
    manager.writeAheadLog({ id: 'tx-log', operations: [] });
    expect(manager.transactionLog).toHaveLength(5000);
    expect(manager.calculateChecksum({ operations: [{ id: 1 }] })).toMatch(/^[a-f0-9]{64}$/);
    expect(manager.generateTransactionId()).toMatch(/^tx_/);

    manager.activeTransactions.set('tx-clean', { id: 'tx-clean' });
    manager.savepoints.set('tx-clean', []);
    jest.useFakeTimers();
    manager.cleanupTransaction('tx-clean');
    jest.advanceTimersByTime(60000);
    expect(manager.activeTransactions.has('tx-clean')).toBe(false);
    expect(manager.savepoints.has('tx-clean')).toBe(false);

    const retry = new TransactionManager({ maxRetries: 0 });
    retry.deadLetterQueue.push({ transaction: { id: 'tx-retry' }, error: 'old', timestamp: Date.now() });
    retry.activeTransactions.set('tx-retry', {
      id: 'tx-retry',
      status: 'ACTIVE',
      operations: [],
      locks: [],
      readSet: new Set(),
      writeSet: new Set()
    });
    await expect(retry.retryDeadLetter(0)).resolves.toEqual({ success: true });
    expect(retry.deadLetterQueue).toHaveLength(0);
  });

  it('detects read-write conflict when overlapping resource is not the first in the set', async () => {
    const manager = new TransactionManager({ maxRetries: 0, enableDLQ: false });
    const tx1 = await manager.beginTransaction('tx-rw-1');
    const tx2 = await manager.beginTransaction('tx-rw-2');

    manager.activeTransactions.get(tx1).readSet = new Set(['a', 'users', 'z']);
    manager.activeTransactions.get(tx2).writeSet = new Set(['x', 'y', 'users']);

    expect(manager.checkConflicts(tx1)).toBe(false);
    await expect(manager.commit(tx1)).rejects.toThrow('Transaction conflict detected');
  });

  it('detects write-read conflict when overlapping resource is not the first', async () => {
    const manager = new TransactionManager({ maxRetries: 0, enableDLQ: false });
    const tx1 = await manager.beginTransaction('tx-wr-1');
    const tx2 = await manager.beginTransaction('tx-wr-2');

    manager.activeTransactions.get(tx1).writeSet = new Set(['a', 'b', 'users', 'c']);
    manager.activeTransactions.get(tx2).readSet = new Set(['users']);

    expect(manager.checkConflicts(tx1)).toBe(false);
    await expect(manager.commit(tx1)).rejects.toThrow('Transaction conflict detected');
  });

  it('detects write-write conflict when overlapping resource is not the first', async () => {
    const manager = new TransactionManager({ maxRetries: 0, enableDLQ: false });
    const tx1 = await manager.beginTransaction('tx-ww-1');
    const tx2 = await manager.beginTransaction('tx-ww-2');

    manager.activeTransactions.get(tx1).writeSet = new Set(['a', 'b', 'c', 'posts']);
    manager.activeTransactions.get(tx2).writeSet = new Set(['x', 'posts']);

    expect(manager.checkConflicts(tx1)).toBe(false);
    await expect(manager.commit(tx1)).rejects.toThrow('Transaction conflict detected');
  });

  it('detects all three conflict paths with single-resource sets (backward compatibility)', async () => {
    const manager = new TransactionManager({ maxRetries: 0, enableDLQ: false });
    const tx1 = await manager.beginTransaction('tx-bc-1');
    const tx2 = await manager.beginTransaction('tx-bc-2');
    manager.activeTransactions.get(tx1).readSet.add('posts');
    manager.activeTransactions.get(tx2).writeSet.add('posts');

    expect(manager.checkConflicts(tx1)).toBe(false);
    await expect(manager.commit(tx1)).rejects.toThrow('Transaction conflict detected');
    expect(manager.getDeadLetterQueue()).toHaveLength(0);

    const retrying = new TransactionManager({ maxRetries: 1, retryDelay: 1 });
    const tx = await retrying.beginTransaction('tx-retry-fail');
    await retrying.executeOperation(tx, {
      type: 'WRITE',
      resource: 'invalid',
      validate: () => false
    }, async () => 'invalid');

    const assertion = expect(retrying.commit(tx)).rejects.toThrow('Operation validation failed for invalid');
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(retrying.getDeadLetterQueue()).toHaveLength(1);
  });

  it('detects transaction conflicts and retry exhaustion without DLQ', async () => {
    const manager = new TransactionManager({ maxRetries: 0, enableDLQ: false });
    const tx1 = await manager.beginTransaction('tx-conflict-1');
    const tx2 = await manager.beginTransaction('tx-conflict-2');
    manager.activeTransactions.get(tx1).readSet.add('posts');
    manager.activeTransactions.get(tx2).writeSet.add('posts');

    expect(manager.checkConflicts(tx1)).toBe(false);
    await expect(manager.commit(tx1)).rejects.toThrow('Transaction conflict detected');
    expect(manager.getDeadLetterQueue()).toHaveLength(0);

    const retrying = new TransactionManager({ maxRetries: 1, retryDelay: 1 });
    const tx = await retrying.beginTransaction('tx-retry-fail');
    await retrying.executeOperation(tx, {
      type: 'WRITE',
      resource: 'invalid',
      validate: () => false
    }, async () => 'invalid');

    const assertion = expect(retrying.commit(tx)).rejects.toThrow('Operation validation failed for invalid');
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(retrying.getDeadLetterQueue()).toHaveLength(1);
  });
});
