class Compiler {
  constructor() {
    this.config = {
      server: {},
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
      seeds: []
    };
  }

  compile(ast) {
    this.config.server = ast.server || { port: 3000, host: '0.0.0.0' };
    this.config.databases = ast.databases || [];
    this.config.models = this.compileModels(ast.models);
    this.config.routes = this.compileRoutes(ast.routes, ast.models);
    this.config.auth = ast.auth;
    this.config.protections = ast.protections;
    this.config.validations = ast.validations;
    this.config.middleware = ast.middleware;
    this.config.security = ast.security;
    this.config.docs = ast.docs;
    this.config.admin = ast.admin;
    this.config.roles = ast.roles || [];
    this.config.jobs = ast.jobs || [];
    this.config.seeds = ast.seeds || [];

    return this.config;
  }

  compileModels(models) {
    return models.map(model => ({
      name: model.name,
      schema: this.generateSchema(model.name, model.schema),
      fields: model.schema
    }));
  }

  generateSchema(modelName, schema) {
    const schemaObj = {};

    for (const [key, type] of Object.entries(schema)) {
      schemaObj[key] = this.mapType(type);
    }

    return schemaObj;
  }

  mapType(typeStr) {
    const typeMap = {
      'string': { type: String },
      'number': { type: Number },
      'boolean': { type: Boolean },
      'date': { type: Date },
      'object': { type: Object },
      'array': { type: Array }
    };

    return typeMap[typeStr.toLowerCase()] || { type: String };
  }

  compileRoutes(routes, models) {
    return routes.map(route => {
      const model = models.find(m => m.name === route.model);

      return {
        method: route.method.toLowerCase(),
        path: route.path,
        model: route.model,
        handler: this.generateHandler(route, model)
      };
    });
  }

  generateHandler(route, model) {
    const handlers = {
      'get': this.generateGetHandler,
      'post': this.generatePostHandler,
      'put': this.generatePutHandler,
      'delete': this.generateDeleteHandler,
      'patch': this.generatePatchHandler
    };

    const handler = handlers[route.method.toLowerCase()];
    return handler ? handler(route, model) : null;
  }

  generateGetHandler(route, model) {
    if (route.path.includes(':id')) {
      return 'findById';
    }
    return 'findAll';
  }

  generatePostHandler(route, model) {
    return 'create';
  }

  generatePutHandler(route, model) {
    return 'updateById';
  }

  generateDeleteHandler(route, model) {
    return 'deleteById';
  }

  generatePatchHandler(route, model) {
    return 'updateById';
  }
}

module.exports = Compiler;
