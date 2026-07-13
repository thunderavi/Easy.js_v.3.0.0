class Tokenizer {
  constructor() {
    this.keywords = new Set([
      'START', 'SERVER', 'USE', 'MODEL', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH',
      'FROM', 'AUTH', 'BY', 'PROTECT', 'VALIDATE', 'MIDDLEWARE', 'MONGODB', 'MYSQL',
      'SEED', 'WITH'
    ]);
  }

  tokenize(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));
    const tokens = [];

    for (const line of lines) {
      const parts = this.tokenizeLine(line);
      tokens.push(...parts);
      tokens.push({ type: 'NEWLINE', value: '\n' });
    }

    return tokens;
  }

  tokenizeLine(line) {
    const tokens = [];
    const regex = /\{([^}]*)\}|\[([^\]]*)\]|"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;

    while ((match = regex.exec(line)) !== null) {
      const [, blockContent, arrayContent, dqString, sqString, word] = match;

      if (blockContent !== undefined) {
        tokens.push({ type: 'BLOCK', value: blockContent.trim() });
      } else if (arrayContent !== undefined) {
        tokens.push({ type: 'BLOCK', value: '[' + arrayContent.trim() + ']' });
      } else if (dqString !== undefined || sqString !== undefined) {
        tokens.push({ type: 'STRING', value: dqString || sqString });
      } else if (word) {
        if (this.keywords.has(word)) {
          tokens.push({ type: word, value: word });
        } else if (word.match(/^[0-9]+$/)) {
          tokens.push({ type: 'NUMBER', value: parseInt(word) });
        } else if (word.match(/^\/.*/) || word.match(/^:[a-zA-Z_]/)) {
          tokens.push({ type: 'PATH', value: word });
        } else if (word.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
          tokens.push({ type: 'IDENTIFIER', value: word });
        } else {
          tokens.push({ type: 'SYMBOL', value: word });
        }
      }
    }

    return tokens;
  }
}

module.exports = Tokenizer;
