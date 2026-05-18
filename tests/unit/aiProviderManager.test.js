jest.mock('openai', () => jest.fn().mockImplementation(config => ({
  config,
  responses: {
    create: jest.fn().mockResolvedValue({
      model: 'constructed-openai',
      output: [{ content: [{ text: 'from constructed openai' }] }]
    })
  },
  embeddings: {
    create: jest.fn().mockResolvedValue({
      model: 'embed-model',
      data: [{ embedding: [0.1, 0.2] }]
    })
  }
})));
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(config => ({
    config,
    models: {
      generateContent: jest.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'from constructed gemini' }] } }]
      })
    }
  }))
}));
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(config => ({
  config,
  messages: {
    create: jest.fn().mockResolvedValue({
      model: 'constructed-claude',
      content: [{ text: 'from constructed anthropic' }]
    })
  }
})));

const AIProviderManager = require('../../core/aiProviderManager');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');

describe('AIProviderManager', () => {
  it('normalizes provider aliases', () => {
    const manager = new AIProviderManager();
    expect(manager.getProvider('google')).toBe('gemini');
    expect(manager.getProvider('openai')).toBe('openai');
    expect(() => manager.getProvider('local')).toThrow('Unsupported AI provider: local');
  });

  it('generates OpenAI completions through the Responses API client', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'gpt-test',
      output_text: 'hello'
    });
    const manager = new AIProviderManager({
      clients: {
        openai: {
          responses: { create }
        }
      }
    });

    const result = await manager.complete('Say hello', { provider: 'openai', model: 'gpt-test' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-test',
      input: 'Say hello'
    }));
    expect(result.text).toBe('hello');
  });

  it('generates Gemini completions through the Google GenAI client', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: 'namaste' });
    const manager = new AIProviderManager({
      clients: {
        gemini: {
          models: { generateContent }
        }
      }
    });

    const result = await manager.complete('Say hi', { provider: 'google', model: 'gemini-test' });

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-test',
      contents: 'Say hi'
    }));
    expect(result.provider).toBe('gemini');
    expect(result.text).toBe('namaste');
  });

  it('generates Anthropic completions through messages API', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-test',
      content: [{ type: 'text', text: 'done' }]
    });
    const manager = new AIProviderManager({
      clients: {
        anthropic: {
          messages: { create }
        }
      }
    });

    const result = await manager.complete('Finish', { provider: 'anthropic', model: 'claude-test' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-test',
      messages: [{ role: 'user', content: 'Finish' }]
    }));
    expect(result.text).toBe('done');
  });

  it('constructs provider clients lazily and extracts fallback text shapes', async () => {
    const manager = new AIProviderManager({
      openaiApiKey: 'openai-key',
      geminiApiKey: 'gemini-key',
      anthropicApiKey: 'anthropic-key'
    });

    await expect(manager.complete([{ role: 'system', content: 'Be brief' }, 'Hello'], { provider: 'openai' }))
      .resolves.toEqual(expect.objectContaining({ text: 'from constructed openai' }));
    await expect(manager.complete({ prompt: 'Hello' }, { provider: 'gemini' }))
      .resolves.toEqual(expect.objectContaining({ text: 'from constructed gemini' }));
    await expect(manager.complete({ input: 'Hello' }, { provider: 'anthropic' }))
      .resolves.toEqual(expect.objectContaining({ text: 'from constructed anthropic' }));

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'openai-key' });
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'gemini-key' });
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'anthropic-key' });
    expect(manager.getClient('google')).toBe(manager.clients.gemini);
  });

  it('creates OpenAI embeddings and rejects unsupported embedding providers', async () => {
    const embeddings = {
      create: jest.fn().mockResolvedValue({
        model: 'text-embedding-test',
        data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }]
      })
    };
    const manager = new AIProviderManager({
      clients: {
        openai: { embeddings }
      }
    });

    await expect(manager.embed(['a', 'b'], { model: 'text-embedding-test' })).resolves.toEqual({
      provider: 'openai',
      model: 'text-embedding-test',
      embeddings: [[1, 2, 3], [4, 5, 6]],
      raw: expect.any(Object)
    });
    expect(embeddings.create).toHaveBeenCalledWith({
      model: 'text-embedding-test',
      input: ['a', 'b']
    });
    await expect(manager.embed('hello', { provider: 'gemini' })).rejects.toThrow('Embeddings are currently implemented');
  });

  it('normalizes prompt variants and exposes completion middleware', async () => {
    const manager = new AIProviderManager({
      clients: {
        openai: {
          responses: {
            create: jest.fn().mockResolvedValue({ output_text: 'middleware-result' })
          }
        }
      }
    });

    expect(manager.normalizePrompt({ anything: true })).toBe('{"anything":true}');
    expect(() => manager.normalizePrompt(null)).toThrow('AI input must be a string');

    const passThroughNext = jest.fn();
    const route = manager.middleware({ path: '/custom-ai' });
    route({ method: 'GET', path: '/custom-ai' }, {}, passThroughNext);
    expect(passThroughNext).toHaveBeenCalled();

    const json = jest.fn();
    await route(
      { method: 'POST', path: '/custom-ai', body: { input: 'hi', provider: 'openai' } },
      { json },
      jest.fn()
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ text: 'middleware-result' }));

    const next = jest.fn();
    await route(
      { method: 'POST', path: '/custom-ai', body: { input: null, provider: 'openai' } },
      { json: jest.fn() },
      next
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
