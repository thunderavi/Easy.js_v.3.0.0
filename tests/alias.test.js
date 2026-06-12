'use strict';

const ASTBuilder = require('../parser/ASTBuilder');
const Compiler   = require('../compiler/Compiler');

describe('ASTBuilder — ALIAS', () => {
  let builder;
  beforeEach(() => { builder = new ASTBuilder(); });

  test('parses ALIAS into ast.aliases array', () => {
    const ast = builder.buildFromContent(`
      GET /blogPosts FROM blogPosts
      ALIAS /blogPosts AS /api/v1/articles
    `);
    expect(ast.aliases).toHaveLength(1);
    expect(ast.aliases[0]).toEqual({ from: '/blogPosts', to: '/api/v1/articles' });
  });

  test('parses multiple ALIAS declarations', () => {
    const ast = builder.buildFromContent(`
      GET /blogPosts FROM blogPosts
      ALIAS /blogPosts AS /api/v1/articles
      ALIAS /blogPosts AS /api/v2/articles
    `);
    expect(ast.aliases).toHaveLength(2);
    expect(ast.aliases[1].to).toBe('/api/v2/articles');
  });

  test('parses ALIAS with param path', () => {
    const ast = builder.buildFromContent(`
      GET /blogPosts/:id FROM blogPosts
      ALIAS /blogPosts/:id AS /api/v1/articles/:id
    `);
    expect(ast.aliases[0]).toEqual({
      from: '/blogPosts/:id',
      to:   '/api/v1/articles/:id'
    });
  });

  test('aliases is empty when no ALIAS declared', () => {
    const ast = builder.buildFromContent(`GET /blogPosts FROM blogPosts`);
    expect(ast.aliases).toEqual([]);
  });
});

describe('Compiler — ALIAS', () => {
  let builder, compiler;
  beforeEach(() => {
    builder  = new ASTBuilder();
    compiler = new Compiler();
  });

  test('compiles alias with same handler as original route', () => {
    const ast    = builder.buildFromContent(`
      MODEL blogPosts { title: string }
      GET /blogPosts FROM blogPosts
      ALIAS /blogPosts AS /api/v1/articles
    `);
    const config = compiler.compile(ast);
    expect(config.aliases).toHaveLength(1);
    expect(config.aliases[0]).toMatchObject({
      method:  'get',
      path:    '/api/v1/articles',
      model:   'blogPosts',
      aliasOf: '/blogPosts'
    });
  });

  test('original route still present after alias', () => {
    const ast    = builder.buildFromContent(`
      MODEL blogPosts { title: string }
      GET /blogPosts FROM blogPosts
      ALIAS /blogPosts AS /api/v1/articles
    `);
    const config = compiler.compile(ast);
    expect(config.routes.find(r => r.path === '/blogPosts')).toBeTruthy();
  });

  test('warns and skips alias when original route not found', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ast     = builder.buildFromContent(`ALIAS /missing AS /api/v1/nothing`);
    const config  = compiler.compile(ast);
    expect(config.aliases).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/missing'));
    warnSpy.mockRestore();
  });
});
