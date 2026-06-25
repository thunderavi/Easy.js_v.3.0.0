const Logger = require('./logger');

class RouterManager {

  sanitizeRecord(record) {
    if (!record) return record;

    const obj = record.toObject ? record.toObject() : { ...record };

    delete obj.password;
    delete obj.passwordHash;
    delete obj.hashedPassword;

    return obj;
  }

  sanitizeResults(result) {
    if (Array.isArray(result)) {
      return result.map(record => this.sanitizeRecord(record));
    }

    return this.sanitizeRecord(result);
  }
  
  registerRoutes(app, routes, db, validator) {
    for (const route of routes) {
      const handler = this.createRouteHandler(route, db, validator);

      const method = route.method.toLowerCase();
      app[method](route.path, handler);

      Logger.debug(`Registered ${method.toUpperCase()} ${route.path}`);
    }
  }


  createRouteHandler(route, db, validator) {
    return async (req, res, next) => {
      try {
        const { method, model, path } = route;

        if (validator && req.body) {
          const validationError = validator.validate(model, req.body);
          if (validationError) {
            return res.status(400).json({
              success: false,
              error: 'Validation failed',
              details: validationError
            });
          }
        }

        let result;

        switch (method.toLowerCase()) {
          case 'get':
            if (req.params.id) {
              result = await db.query(model, 'findById', req.params.id);
            } else {
              result = await db.query(model, 'findAll', null, {
                limit: req.query.limit || 100,
                filter: req.query.filter
              });
            }
            break;

          case 'post':
            result = await db.query(model, 'create', req.body);
            return res.status(201).json({
              success: true,
              data: this.sanitizeResults(result)
            });

          case 'put':
          case 'patch':
            result = await db.query(model, 'updateById', {
              id: req.params.id,
              updates: req.body
            });
            break;

          case 'delete':
            result = await db.query(model, 'deleteById', req.params.id);
            return res.status(204).send();

          default:
            return res.status(405).json({
              success: false,
              error: 'Method not allowed'
            });
        }

        res.json({
          success: true,
          data: this.sanitizeResults(result)
        });
      } catch (error) {
        Logger.error(`Route error: ${error.message}`);
        next(error);
      }
    };
  }
}

module.exports = RouterManager;
