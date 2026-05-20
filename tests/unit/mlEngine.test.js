jest.mock('@tensorflow/tfjs', () => {
  const tensor = () => ({ dispose: jest.fn() });
  return {
    loadLayersModel: jest.fn(),
    sequential: jest.fn(),
    layers: {
      dense: jest.fn(config => ({ type: 'dense', config })),
      dropout: jest.fn(config => ({ type: 'dropout', config }))
    },
    train: {
      adam: jest.fn(rate => ({ optimizer: 'adam', rate }))
    },
    tensor2d: jest.fn(tensor)
  };
});

const fs = require('fs');
const tf = require('@tensorflow/tfjs');
const MLEngine = require('../../core/mlEngine');

const createModel = () => ({
  compile: jest.fn(),
  fit: jest.fn().mockResolvedValue({ history: { loss: [0.1] } }),
  predict: jest.fn(() => ({
    data: jest.fn().mockResolvedValue([0.2, 0.8, 0.4, 0.6]),
    dispose: jest.fn()
  })),
  save: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn(() => [
    { dataSync: () => [0.25] },
    { dataSync: () => [0.95] }
  ])
});

describe('MLEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('initializes, loads, creates, trains, saves, and evaluates models', async () => {
    const engine = new MLEngine();
    const model = createModel();
    tf.loadLayersModel.mockResolvedValue(model);
    tf.sequential.mockReturnValue(model);
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

    await engine.initialize({ enabled: true });
    await expect(engine.loadModel('fraud', 'C:/tmp/fraud-model')).resolves.toBe(model);
    await expect(engine.createSimpleModel(3, 2)).resolves.toBe(model);
    await expect(engine.trainModel('fraud', {
      features: [[1, 2, 3]],
      labels: [[0, 1]]
    }, 1, 1)).resolves.toEqual({ history: { loss: [0.1] } });

    await engine.saveModel('fraud', 'C:/tmp/models/fraud');
    expect(model.save).toHaveBeenCalledWith('file://C:/tmp/models/fraud');
    expect(engine.evaluateModel('fraud', {
      features: [[1, 2, 3]],
      labels: [[0, 1]]
    })).toEqual({ loss: 0.25, accuracy: 0.95 });
  });

  it('predicts, batch predicts, and tracks prediction history', async () => {
    const engine = new MLEngine();
    engine.models.set('fraud', createModel());

    await expect(engine.predict('fraud', [1, 2, 3])).resolves.toEqual(expect.objectContaining({
      prediction: [0.2, 0.8, 0.4, 0.6],
      confidence: 0.8
    }));
    await expect(engine.batchPredict('fraud', [[1, 2], [3, 4]])).resolves.toEqual([
      [0.2, 0.8],
      [0.4, 0.6]
    ]);

    expect(engine.getModelsList()).toEqual(['fraud']);
    expect(engine.getPredictionHistory('fraud')).toHaveLength(1);
    engine.clearPredictionHistory();
    expect(engine.getPredictionHistory()).toEqual([]);
  });

  it('registers prediction API routes and handles success and validation errors', async () => {
    const engine = new MLEngine();
    engine.models.set('fraud', createModel());
    const routes = {};
    const app = {
      post: jest.fn((route, handler) => {
        routes[`POST ${route}`] = handler;
      }),
      get: jest.fn((route, handler) => {
        routes[`GET ${route}`] = handler;
      })
    };
    const res = () => ({
      status: jest.fn(function status() { return this; }),
      json: jest.fn()
    });

    engine.generatePredictionAPI('fraud', app);

    const predictRes = res();
    await routes['POST /ml/fraud/predict']({ body: { data: [1, 2] } }, predictRes);
    expect(predictRes.json).toHaveBeenCalledWith(expect.objectContaining({ confidence: 0.8 }));

    const invalidPredictRes = res();
    await routes['POST /ml/fraud/predict']({ body: {} }, invalidPredictRes);
    expect(invalidPredictRes.status).toHaveBeenCalledWith(400);

    const batchRes = res();
    await routes['POST /ml/fraud/batch-predict']({ body: { dataArray: [[1, 2], [3, 4]] } }, batchRes);
    expect(batchRes.json).toHaveBeenCalledWith({ predictions: [[0.2, 0.8], [0.4, 0.6]] });

    const invalidBatchRes = res();
    await routes['POST /ml/fraud/batch-predict']({ body: {} }, invalidBatchRes);
    expect(invalidBatchRes.status).toHaveBeenCalledWith(400);

    const statsRes = res();
    routes['GET /ml/fraud/stats']({}, statsRes);
    expect(statsRes.json).toHaveBeenCalledWith(expect.objectContaining({
      totalPredictions: 1,
      averageConfidence: 0.8
    }));
  });

  it('exports React and Vue components and rejects missing models', async () => {
    const engine = new MLEngine();
    engine.models.set('fraud', createModel());

    await expect(engine.exportModelAsComponent('fraud', 'react')).resolves.toContain('export function fraudPredictor');
    await expect(engine.exportModelAsComponent('fraud', 'vue')).resolves.toContain('<template>');
    await expect(engine.exportModelAsComponent('missing')).rejects.toThrow('Model missing not found');
    await expect(engine.predict('missing', [1])).rejects.toThrow('Model missing not found');
  });

  it('surfaces TensorFlow operation failures and API handler errors', async () => {
    const engine = new MLEngine();
    tf.loadLayersModel.mockRejectedValueOnce(new Error('load failed'));
    await expect(engine.loadModel('broken', 'C:/tmp/missing')).rejects.toThrow();

    const failingModel = createModel();
    failingModel.fit.mockRejectedValueOnce(new Error('fit failed'));
    failingModel.predict.mockImplementationOnce(() => {
      throw new Error('predict failed');
    });
    failingModel.evaluate.mockImplementationOnce(() => {
      throw new Error('evaluate failed');
    });
    failingModel.save.mockRejectedValueOnce(new Error('save failed'));
    engine.models.set('broken', failingModel);

    await expect(engine.trainModel('broken', { features: [[1]], labels: [[1]] })).rejects.toThrow('fit failed');
    await expect(engine.predict('broken', [1])).rejects.toThrow('predict failed');
    expect(() => engine.evaluateModel('broken', { features: [[1]], labels: [[1]] })).toThrow('evaluate failed');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    await expect(engine.saveModel('broken', 'C:/tmp/model')).rejects.toThrow('save failed');

    await expect(engine.trainModel('missing', { features: [], labels: [] })).rejects.toThrow('Model missing not found');
    await expect(engine.batchPredict('missing', [])).rejects.toThrow('Model missing not found');
    await expect(engine.saveModel('missing', 'C:/tmp/model')).rejects.toThrow('Model missing not found');
    expect(() => engine.evaluateModel('missing', { features: [], labels: [] })).toThrow('Model missing not found');
    await expect(engine.exportModelAsComponent('broken', 'svelte')).resolves.toBeUndefined();

    const routes = {};
    engine.generatePredictionAPI('missing', {
      post: (route, handler) => { routes[route] = handler; },
      get: (route, handler) => { routes[route] = handler; }
    });
    const res = {
      status: jest.fn(function status() { return this; }),
      json: jest.fn()
    };
    await routes['/ml/missing/predict']({ body: { data: [1] } }, res);
    expect(res.status).toHaveBeenCalledWith(500);

    const batchRes = {
      status: jest.fn(function status() { return this; }),
      json: jest.fn()
    };
    await routes['/ml/missing/batch-predict']({ body: { dataArray: [[1]] } }, batchRes);
    expect(batchRes.status).toHaveBeenCalledWith(500);
  });
});
