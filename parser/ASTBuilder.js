class ASTBuilder {
  constructor() {
    this.reset();
  }

  reset() {
    this.ast = {
      server: null,
      databases: [],
      models: [],
      routes: [],
      auth: null,
      protections: [],
      validations: [],
      middleware: [],
      security: null,
      docs: false,
      admin: false,
      roles: [],
      jobs: [],
    };
  }

  buildFromContent(content) {
    this.reset();
    const normalized = this.stripComments(content);

    this.parseServerFromContent(normalized);
    this.parseUseFromContent(normalized);
    this.parseBlocksFromContent(normalized, 'MODEL', (name, body) => {
      this.ast.models.push({ name, schema: this.parseSchema(body) });
    });
    this.parseRoutesFromContent(normalized);
    this.parseAuthFromContent(normalized);
    this.parseProtectFromContent(normalized);
    this.parseBlocksFromContent(normalized, 'VALIDATE', (name, body) => {
      this.ast.validations.push({ model: name, rules: this.parseValidationRules(body) });
    });
    this.parseSecurityFromContent(normalized);
    this.parseRolesFromContent(normalized);
    this.parseJobsFromContent(normalized);

    return this.ast;
  }

  stripComments(content) {
    return content
      .split('\n')
      .map((line) => line.replace(/(^|\s)#.*$/, '').replace(/(^|\s)\/\/.*$/, ''))
      .join('\n');
  }

  parseServerFromContent(content) {
    const match = content.match(/\bSTART\s+SERVER\s+(\d+)/i);
    if (match) {
      this.ast.server = { port: parseInt(match[1], 10), host: '0.0.0.0' };
    }
  }

  parseUseFromContent(content) {
    const useRegex = /^\s*USE\s+(\w+)\s+(.+)$/gim;
    let match;
    while ((match = useRegex.exec(content)) !== null) {
      const type = match[1].toLowerCase();
      const value = match[2].trim();
      if (
        [
          'mongodb',
          'mongo',
          'mysql',
          'mariadb',
          'planetscale',
          'postgres',
          'postgresql',
          'pg',
          'cockroach',
          'cockroachdb',
          'neon',
          'redis',
          'firebase',
          'firestore',
          'dynamodb',
          'supabase',
          'elasticsearch',
          'elastic',
          'opensearch',
          'cassandra',
          'sqlite',
          'sqlite3',
          'libsql',
          'turso',
          'mssql',
          'sqlserver',
          'neo4j',
          'oracle',
          'oracledb',
          'snowflake',
          'bigquery',
        ].includes(type)
      ) {
        this.ast.databases.push({ type, connection: value });
      } else {
        this.ast.middleware.push(match[1]);
      }
    }
  }

  parseBlocksFromContent(content, keyword, callback) {
    const blockRegex = new RegExp(`\\b${keyword}\\s+(\\w+)\\s*\\{([\\s\\S]*?)\\}`, 'gi');
    let match;
    while ((match = blockRegex.exec(content)) !== null) {
      callback(match[1], match[2]);
    }
  }

  parseRoutesFromContent(content) {
    const routeRegex = /^\s*(GET|POST|PUT|DELETE|PATCH)\s+(\/\S*)\s+FROM\s+(\w+)/gim;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      this.ast.routes.push({
        method: match[1],
        path: match[2],
        model: match[3],
      });
    }
  }

  parseAuthFromContent(content) {
    const authRegex = /^\s*AUTH\s+(\w+)\s+BY\s+(\w+)/gim;
    const auth = [];
    let match;
    while ((match = authRegex.exec(content)) !== null) {
      auth.push({ model: match[1], type: match[2] });
    }
    if (auth.length > 0) {
      this.ast.auth = auth[0];
      this.ast.auth.features = this.parseAuthFeatures(content);
    }
  }

  parseAuthFeatures(content) {
    const features = {};
    const featureRegex = /^\s*AUTH\s+(\w+)\s+enabled/gim;
    let match;
    while ((match = featureRegex.exec(content)) !== null) {
      features[match[1]] = true;
    }
    return features;
  }

  parseProtectFromContent(content) {
    const protectRegex = /^\s*PROTECT\s+(\/\S*)/gim;
    let match;
    while ((match = protectRegex.exec(content)) !== null) {
      this.ast.protections.push({ path: match[1] });
    }
  }

  parseSecurityFromContent(content) {
    const security = content.match(/^\s*SECURITY\s+(\w+)/im);
    const docs = content.match(/^\s*DOCS\s+(\w+)/im);
    const admin = content.match(/^\s*ADMIN\s+(\w+)/im);
    if (security) this.ast.security = security[1].toLowerCase();
    if (docs) this.ast.docs = docs[1].toLowerCase() !== 'disabled';
    if (admin) this.ast.admin = admin[1].toLowerCase() !== 'disabled';
  }

  parseRolesFromContent(content) {
    const roleRegex = /^\s*ROLE\s+(\w+)\s+CAN\s+(.+)$/gim;
    let match;
    while ((match = roleRegex.exec(content)) !== null) {
      this.ast.roles.push({
        role: match[1],
        permissions: match[2]
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });
    }
  }

  parseJobsFromContent(content) {
    const jobRegex = /\bJOB\s+(\w+)(?:\s+EVERY\s+(\S+))?\s*\{([\s\S]*?)\}/gi;
    let match;
    while ((match = jobRegex.exec(content)) !== null) {
      this.ast.jobs.push({
        name: match[1],
        every: match[2] || null,
        body: match[3].trim(),
      });
    }
  }

  build(tokens) {
    this.reset();
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === 'START' && tokens[i + 1]?.type === 'SERVER') {
        this.ast.server = this.parseServer(tokens, i);
        i = this.findNextStatement(tokens, i);
      } else if (token.type === 'USE') {
        const result = this.parseUse(tokens, i);
        if (result.type === 'database') {
          this.ast.databases.push(result.value);
        } else if (result.type === 'middleware') {
          this.ast.middleware.push(result.value);
        }
        i = this.findNextStatement(tokens, i);
      } else if (token.type === 'MODEL') {
        this.ast.models.push(this.parseModel(tokens, i));
        i = this.findNextStatement(tokens, i);
      } else if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(token.type)) {
        this.ast.routes.push(this.parseRoute(tokens, i));
        i = this.findNextStatement(tokens, i);
      } else if (token.type === 'AUTH') {
        this.ast.auth = this.parseAuth(tokens, i);
        i = this.findNextStatement(tokens, i);
      } else if (token.type === 'PROTECT') {
        this.ast.protections.push(this.parseProtect(tokens, i));
        i = this.findNextStatement(tokens, i);
      } else if (token.type === 'VALIDATE') {
        this.ast.validations.push(this.parseValidate(tokens, i));
        i = this.findNextStatement(tokens, i);
      } else {
        i++;
      }
    }

    return this.ast;
  }

  parseServer(tokens, start) {
    const portToken = tokens[start + 2];
    if (!portToken || portToken.type !== 'NUMBER') {
      throw new Error('SERVER requires a valid port number');
    }
    return {
      port: portToken.value,
      host: '0.0.0.0',
    };
  }

  parseUse(tokens, start) {
    const nextToken = tokens[start + 1];

    if (nextToken?.type === 'MONGODB') {
      const connToken = tokens[start + 2];
      return {
        type: 'database',
        value: {
          type: 'mongodb',
          connection: connToken?.value || 'mongodb://localhost:27017/db',
        },
      };
    } else if (nextToken?.type === 'MYSQL') {
      const connToken = tokens[start + 2];
      return {
        type: 'database',
        value: {
          type: 'mysql',
          connection: connToken?.value || 'mysql://root:root@localhost:3306/db',
        },
      };
    } else if (nextToken?.type === 'IDENTIFIER') {
      return {
        type: 'middleware',
        value: nextToken.value,
      };
    }

    return { type: 'unknown', value: null };
  }

  parseModel(tokens, start) {
    const nameToken = tokens[start + 1];
    if (!nameToken || nameToken.type !== 'IDENTIFIER') {
      throw new Error('MODEL requires a valid name');
    }

    const blockToken = tokens[start + 2];
    if (!blockToken || blockToken.type !== 'BLOCK') {
      throw new Error('MODEL requires a schema block');
    }

    const schema = this.parseSchema(blockToken.value);

    return {
      name: nameToken.value,
      schema: schema,
    };
  }

  parseSchema(blockContent) {
    const schema = {};
    const lines = blockContent.split('\n');

    for (const line of lines) {
      const [key, type] = line
        .trim()
        .split(':')
        .map((s) => s.trim());
      if (key && type) {
        schema[key] = type;
      }
    }

    return schema;
  }

  findStatementEnd(tokens, start) {
    for (let i = start; i < tokens.length; i++) {
      if (tokens[i].type === 'NEWLINE') {
        return i;
      }
    }
    return tokens.length;
  }

  parseRoute(tokens, start) {
    const method = tokens[start].type;
    const pathToken = tokens[start + 1];
    if (!pathToken || pathToken.type !== 'PATH') {
      throw new Error(`${method} requires a valid path`);
    }

    const stmtEnd = this.findStatementEnd(tokens, start);
    const fromIndex = tokens.findIndex((t, i) => i > start && i < stmtEnd && t.type === 'FROM');
    if (fromIndex === -1) {
      throw new Error(
        `${method} route at "${pathToken.value}" requires a FROM clause in the same statement`
      );
    }

    const modelToken = tokens[fromIndex + 1];
    if (!modelToken || modelToken.type !== 'IDENTIFIER') {
      throw new Error(`FROM requires a valid model name`);
    }

    return {
      method,
      path: pathToken.value,
      model: modelToken.value,
    };
  }

  parseAuth(tokens, start) {
    const modelIndex = start + 1;

    const stmtEnd = this.findStatementEnd(tokens, start);
    const byIndex = tokens.findIndex((t, i) => i > start && i < stmtEnd && t.type === 'BY');

    if (byIndex === -1) {
      throw new Error('AUTH requires a BY clause in the same statement');
    }

    const modelToken = tokens[modelIndex];
    const typeToken = tokens[byIndex + 1];

    return {
      model: modelToken?.value || 'users',
      type: typeToken?.value || 'jwt',
    };
  }

  parseProtect(tokens, start) {
    const pathToken = tokens[start + 1];
    if (!pathToken || pathToken.type !== 'PATH') {
      throw new Error('PROTECT requires a valid path');
    }

    return {
      path: pathToken.value,
    };
  }

  parseValidate(tokens, start) {
    const modelToken = tokens[start + 1];
    const blockToken = tokens[start + 2];

    if (!modelToken || !blockToken) {
      throw new Error('VALIDATE requires model and rules block');
    }

    const rules = this.parseValidationRules(blockToken.value);

    return {
      model: modelToken.value,
      rules: rules,
    };
  }

  parseValidationRules(blockContent) {
    const rules = {};
    const lines = blockContent.split('\n');

    for (const line of lines) {
      const [field, ...ruleParts] = line
        .trim()
        .split(':')
        .map((s) => s.trim());
      if (field && ruleParts.length > 0) {
        rules[field] = ruleParts.join(':');
      }
    }

    return rules;
  }

  findNextStatement(tokens, current) {
    for (let i = current + 1; i < tokens.length; i++) {
      if (tokens[i].type === 'NEWLINE' && tokens[i + 1]?.type !== 'NEWLINE') {
        return i + 1;
      }
    }
    return tokens.length;
  }
}

module.exports = ASTBuilder;
