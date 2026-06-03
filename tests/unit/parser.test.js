'use strict';

const ASTBuilder = require('../../parser/ASTBuilder');
const Tokenizer = require('../../parser/Tokenizer');

function tokenize(dsl) {
  return new Tokenizer().tokenize(dsl);
}

function buildAST(dsl) {
  const tokens = tokenize(dsl);
  return new ASTBuilder().build(tokens);
}

describe('ASTBuilder.findStatementEnd()', () => {
  test('returns the index of the first NEWLINE after start', () => {
    const builder = new ASTBuilder();
    const tokens = [
      { type: 'GET', value: 'GET' },
      { type: 'PATH', value: '/users' },
      { type: 'FROM', value: 'FROM' },
      { type: 'IDENTIFIER', value: 'User' },
      { type: 'NEWLINE', value: '\n' },
      { type: 'POST', value: 'POST' },
    ];
    expect(builder.findStatementEnd(tokens, 0)).toBe(4);
  });

  test('returns tokens.length when no NEWLINE exists', () => {
    const builder = new ASTBuilder();
    const tokens = [
      { type: 'GET', value: 'GET' },
      { type: 'PATH', value: '/ping' },
      { type: 'FROM', value: 'FROM' },
      { type: 'IDENTIFIER', value: 'Ping' },
    ];
    expect(builder.findStatementEnd(tokens, 0)).toBe(tokens.length);
  });
});

describe('parseRoute() — FROM clause scoped to current statement', () => {
  test('parses a valid route correctly', () => {
    const ast = buildAST('GET /users FROM User');
    expect(ast.routes).toHaveLength(1);
    expect(ast.routes[0]).toEqual({ method: 'GET', path: '/users', model: 'User' });
  });

  test('throws when FROM is missing from the current statement', () => {
    const dsl = `GET /users
POST /posts FROM Post`;
    expect(() => buildAST(dsl)).toThrow(/FROM/i);
  });

  test('does NOT silently adopt a FROM from a later route', () => {
    const dsl = `GET /users FROM User
POST /posts FROM Post`;
    const ast = buildAST(dsl);
    expect(ast.routes).toHaveLength(2);
    expect(ast.routes[0]).toMatchObject({ method: 'GET', path: '/users', model: 'User' });
    expect(ast.routes[1]).toMatchObject({ method: 'POST', path: '/posts', model: 'Post' });
  });

  test('throws for back-to-back routes where the first is missing FROM', () => {
    const dsl = `GET /a
POST /b FROM Item`;
    expect(() => buildAST(dsl)).toThrow(/FROM/i);
  });

  test('parses multiple valid back-to-back routes independently', () => {
    const dsl = [
      'GET    /articles FROM Article',
      'DELETE /articles FROM Article',
      'PUT    /articles FROM Article',
    ].join('\n');
    const ast = buildAST(dsl);
    expect(ast.routes).toHaveLength(3);
    expect(ast.routes.map((r) => r.method)).toEqual(['GET', 'DELETE', 'PUT']);
  });
});

describe('parseAuth() — BY clause scoped to current statement', () => {
  test('parses a valid AUTH statement correctly', () => {
    const ast = buildAST('AUTH User BY jwt');
    expect(ast.auth).toMatchObject({ model: 'User', type: 'jwt' });
  });

  test('throws when BY is missing from the AUTH statement', () => {
    const dsl = `AUTH User
GET /posts FROM Post`;
    expect(() => buildAST(dsl)).toThrow(/BY/i);
  });

  test('does NOT silently adopt a BY from a later statement', () => {
    const dsl = `AUTH User
AUTH Admin BY oauth`;
    expect(() => buildAST(dsl)).toThrow(/BY/i);
  });
});
