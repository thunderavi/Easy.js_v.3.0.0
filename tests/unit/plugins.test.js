const PluginSystem = require('../../core/plugins');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('PluginSystem', () => {
  it('registers plugins, hooks, middleware, validators, and generators', async () => {
    class Instance {
      destroy = jest.fn();
    }
    const system = new PluginSystem();
    const registered = jest.fn();
    system.on('plugin:registered', registered);

    system.registerPlugin('core-plugin', {
      name: 'core-plugin',
      version: '1.0.0',
      description: 'Test plugin',
      author: 'easy.js',
      init: Instance,
      hooks: {
        compile: async context => ({ ...context, compiled: true })
      },
      middleware: [
        async (req, res, next) => {
          req.pluginTouched = true;
          await next();
        }
      ],
      validators: [
        async data => ({ valid: Boolean(data.ok), errors: data.ok ? [] : ['not ok'] })
      ],
      generators: {
        route: config => `GET ${config.path}`
      }
    });

    expect(registered).toHaveBeenCalled();
    expect(await system.executeHook('compile', { source: 'x' })).toEqual({
      source: 'x',
      compiled: true
    });
    await expect(system.generateCode('route', { path: '/posts' })).resolves.toBe('GET /posts');
    expect(system.getGenerators()).toEqual([{ name: 'route', plugin: 'core-plugin' }]);
    expect(system.getPluginInfo('core-plugin')).toEqual(expect.objectContaining({
      name: 'core-plugin',
      version: '1.0.0',
      middlewareCount: 1,
      validatorCount: 1,
      generators: ['route']
    }));
    await expect(system.runValidators({ ok: false }, {})).resolves.toEqual({
      valid: false,
      errors: ['not ok']
    });
  });

  it('enforces metadata and dependencies', () => {
    const system = new PluginSystem();

    expect(() => system.registerPlugin('bad', { version: '1.0.0' })).toThrow('name and version');
    expect(() => system.registerPlugin('needs-missing', {
      name: 'needs-missing',
      version: '1.0.0',
      dependencies: ['missing']
    })).toThrow('Plugin dependency not found: missing');
  });

  it('executes middleware chains and handles middleware errors', async () => {
    const system = new PluginSystem();
    system.registerPlugin('middleware-plugin', {
      name: 'middleware-plugin',
      version: '1.0.0',
      middleware: [
        async (req, res, next) => {
          req.steps.push('first');
          await next();
        },
        async (req, res, next) => {
          req.steps.push('second');
          await next();
        }
      ]
    });

    const next = jest.fn();
    const req = { steps: [] };
    await system.executeMiddleware(req, {}, next);

    expect(req.steps).toEqual(['first', 'second']);
    expect(next).toHaveBeenCalled();

    const failing = new PluginSystem();
    failing.registerPlugin('bad-middleware', {
      name: 'bad-middleware',
      version: '1.0.0',
      middleware: [async () => { throw new Error('boom'); }]
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await failing.executeMiddleware({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('unloads plugins and reports status', () => {
    const system = new PluginSystem();
    const unloaded = jest.fn();
    system.on('plugin:unloaded', unloaded);
    const instance = { destroy: jest.fn() };
    system.plugins.set('manual', {
      name: 'manual',
      version: '1.0.0',
      description: '',
      author: '',
      hooks: { build: jest.fn() },
      middleware: [jest.fn()],
      validators: [jest.fn()],
      generators: { page: jest.fn() },
      instance
    });
    system.registerHook('build', jest.fn(), 'manual');
    system.middleware.push({ name: 'manual', middleware: jest.fn() });
    system.validators.push({ name: 'manual', validator: jest.fn() });
    system.registerGenerator('page', jest.fn(), 'manual');

    expect(system.getStatus().pluginCount).toBe(1);
    system.unloadPlugin('manual');

    expect(instance.destroy).toHaveBeenCalled();
    expect(unloaded).toHaveBeenCalledWith({ name: 'manual' });
    expect(system.getStatus().pluginCount).toBe(0);
    expect(system.getPluginInfo('manual')).toBeNull();
  });

  it('loads plugins from files and directories while tolerating missing directories', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-easy-plugin-'));
    try {
      const pluginPath = path.join(dir, 'sample.js');
      const ignoredPath = path.join(dir, 'README.md');
      fs.writeFileSync(pluginPath, `module.exports = {
        name: 'sample',
        version: '1.0.0',
        hooks: { boot: async context => ({ ...context, booted: true }) }
      };`);
      fs.writeFileSync(ignoredPath, 'ignore me');

      const system = new PluginSystem({ pluginDir: dir });
      await expect(system.loadPluginFromFile(pluginPath)).resolves.toBe('sample');
      await expect(system.executeHook('boot', {})).resolves.toEqual({ booted: true });

      const second = new PluginSystem({ pluginDir: dir });
      await expect(second.loadPluginsFromDirectory()).resolves.toEqual(['sample']);
      await expect(second.loadPluginsFromDirectory(path.join(dir, 'missing'))).resolves.toEqual([]);

      await expect(system.loadPluginFromFile(path.join(dir, 'missing.js'))).rejects.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles hook, generator, validator, middleware, and hot reload edge paths', async () => {
    const system = new PluginSystem();
    const hookError = jest.fn();
    const codeGenerated = jest.fn();
    system.on('hook:error', hookError);
    system.on('code:generated', codeGenerated);

    await expect(system.executeHook('missing', { ok: true })).resolves.toEqual({ ok: true });
    system.registerPlugin('edge', {
      name: 'edge',
      version: '1.0.0',
      hooks: {
        bad: () => {
          throw new Error('hook failed');
        }
      },
      validators: [
        () => {
          throw new Error('validator failed');
        },
        () => ({ valid: true, errors: [] })
      ],
      generators: {
        good: config => `hello ${config.name}`,
        bad: () => {
          throw new Error('generation failed');
        }
      }
    });

    await expect(system.executeHook('bad', { original: true })).resolves.toEqual({ original: true });
    expect(hookError).toHaveBeenCalledWith({ hook: 'bad', error: expect.any(Error) });
    await expect(system.generateCode('missing', {})).rejects.toThrow('Code generator not found');
    await expect(system.generateCode('good', { name: 'framework' })).resolves.toBe('hello framework');
    expect(codeGenerated).toHaveBeenCalledWith({ generator: 'good', config: { name: 'framework' } });
    await expect(system.generateCode('bad', {})).rejects.toThrow('generation failed');
    await expect(system.runValidators({}, {})).resolves.toEqual({ valid: true, errors: [] });

    const next = jest.fn();
    await new PluginSystem().executeMiddleware({}, {}, next);
    expect(next).toHaveBeenCalled();

    const noReload = new PluginSystem({ enableHotReload: false });
    expect(noReload.enableHotReload('x', 'missing.js')).toBeUndefined();

    const watchFile = jest.spyOn(fs, 'watchFile').mockImplementation((file, callback) => {
      callback({ mtime: new Date(2) }, { mtime: new Date(1) });
    });
    const reloadError = jest.fn();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-easy-plugin-reload-'));
    try {
      const pluginPath = path.join(dir, 'reload.js');
      fs.writeFileSync(pluginPath, `module.exports = { name: 'reload', version: '1.0.0' };`);
      system.on('plugin:reload:error', reloadError);
      system.enableHotReload('reload', pluginPath);
      expect(watchFile).toHaveBeenCalledWith(pluginPath, expect.any(Function));
      watchFile.mockRestore();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
