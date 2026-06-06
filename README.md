# easy.js - Backend Framework for Node.js/Express

A developer-friendly backend framework that transforms simple DSL syntax into functional Node.js/Express applications with built-in security, validation, and database support.

Author: Avi Ranjan Prasad

<p align="center">
  <img src="https://raw.githubusercontent.com/Avi-Ranjan-Prasad/easy.js/main/public/easyjs-logo.svg" alt="easy.js logo" width="220">
</p>

> Validation note: core adapters are covered by local contract tests. Paid/cloud/provider adapters such as Supabase, Firebase, DynamoDB, Elasticsearch/OpenSearch, Cassandra, and Neo4j require `LIVE_ADAPTERS=true` plus real service credentials or local services for live validation. See [Live Adapter Validation](docs/LIVE_ADAPTERS.md).

## 📑 Table of Contents

- [easy.js - Backend Framework](#easyjs---backend-framework-for-nodejsexpress)
- [Start in One Minute](#start-in-one-minute)
- [What is easy.js](#what-is-easyjs)
- [Quick Start](#quick-start)
  - [Installation](#installation)
  - [Create a Project](#create-a-project)
  - [Your First API](#your-first-api)
- [Language Syntax](#language-syntax)
- [Project Structure](#project-structure)
- [Security Features](#security-features)
- [Environment Configuration](#environment-variables)
- [Database Support](#database-support)
- [Validation](#validation)
- [API Response Format](#api-response-format)
- [CLI Commands](#cli-commands)
- [Deployment](#deployment)
- [Testing Your API](#testing-your-api)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Contributing](#contributing)


## Start in One Minute

```bash
npx easybackend.js create my-api
cd my-api
npm install
npm run doctor
npm run dev
```

```easy
START SERVER 3000
USE MONGODB mongodb://localhost:27017/blog

SECURITY strict
DOCS openapi
ADMIN enabled

MODEL posts {
  title: string
  content: string
}

GET /posts FROM posts
POST /posts FROM posts
PROTECT /posts
```

New user guides:

- [Getting Started](docs/GETTING_STARTED.md)
- [easy.js Language](docs/EASY_LANGUAGE.md)
- [AI, Cloud, and DevOps Support](docs/AI_CLOUD_DEVOPS.md)
- [Database Support](docs/DATABASES.md)
- [Live Adapter Validation](docs/LIVE_ADAPTERS.md)
- [Security Defaults](docs/SECURITY_DEFAULTS.md)
- [IDE Support](docs/IDE.md)
- [Language Specification](docs/LANGUAGE_SPEC.md)
- [Runtime Semantics](docs/RUNTIME_SEMANTICS.md)
- [AST Documentation](docs/AST.md)
- [Backward Compatibility](docs/BACKWARD_COMPATIBILITY.md)
- [Generated Code Security](docs/GENERATED_CODE_SECURITY.md)

## What is easy.js?

easy.js simplifies backend development by letting you write backend applications in a clean, human-readable DSL instead of complex Express.js code. Write simple declarations, get a fully functional REST API with:

- Express.js server setup
- MongoDB, MySQL, PostgreSQL, SQLite, Redis, and additional provider adapter support
- JWT authentication
- Input validation
- Rate limiting & security headers
- CORS configuration
- Error handling
- Database migrations
- Live provider validation harness for credential-backed services

## Modern AI, Cloud, and DevOps

- OpenAI, Google Gemini, and Anthropic SDK support through `AIProviderManager`
- TensorFlow.js local ML utilities
- AWS SDK v3 for S3 and DynamoDB
- MongoDB, MySQL/MariaDB, PostgreSQL, SQLite, libSQL/Turso, SQL Server, Redis, Firebase, DynamoDB, Supabase, Elasticsearch/OpenSearch, Cassandra, and Neo4j database adapters
- Google Cloud Storage, Azure Blob Storage, and S3 storage adapters
- Docker, Docker Compose, Kubernetes, Helm, Terraform for AWS ECS/Fargate, GitHub Actions CI, Sentry, OpenTelemetry, and Prometheus

## Quick Start

### Installation

```bash
npm install easybackend.js
```

Provider SDKs and database drivers are optional so normal installs stay small. Install only what your app uses, for example:

```bash
npm install mongoose
npm install pg
npm install @supabase/supabase-js
```

`easyjs doctor` reads your `.easy` files and tells you the exact package to install when a selected provider is missing.

New projects also include an editable `template/` folder. Put plain HTML, CSS, and JavaScript there and easy.js serves it at `/`, so you can design a small UI without setting up a separate frontend build. The generated `template/api.js` exposes `EasyAPI.get()`, `EasyAPI.post()`, and related helpers for calling your backend.

You can choose a UI preset:

```bash
npx easybackend.js create my-api --ui bootstrap
npx easybackend.js create my-api --ui tailwind
easyjs add ui bootstrap
easyjs add ui tailwind
easyjs add page dashboard
```

### Create a Project

```bash
npx easybackend.js create my-api
cd my-api
npm install
npm start
```

### Your First API

Create `app.easy`:

```
START SERVER 3000

USE MONGODB mongodb://localhost:27017/mydb

MODEL users {
  name: string
  email: string
  password: string
}

AUTH users BY jwt

GET /users FROM users
POST /users FROM users
PUT /users/:id FROM users
DELETE /users/:id FROM users

VALIDATE users {
  email: required:email
  password: required:min=6
  name: required
}

PROTECT /users
```

Run it:

```bash
easyjs start app.easy
```

Your API is now running on `http://localhost:3000`

## Language Syntax

### Server Configuration

```
START SERVER <port>
```

Example:
```
START SERVER 3000
```

### Database Configuration

```
USE MONGODB <connection_string>
USE MYSQL <connection_string>
```

Examples:
```
USE MONGODB mongodb://localhost:27017/myapp
USE MYSQL mysql://root:password@localhost:3306/myapp
```

### Model Definition

```
MODEL <name> {
  field: type
  field: type
}
```

Supported types: `string`, `number`, `boolean`, `date`, `object`, `array`

Example:
```
MODEL users {
  name: string
  email: string
  age: number
  isActive: boolean
}
```

### Routes

```
<METHOD> <path> FROM <model>
```

Methods: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`

Examples:
```
GET /users FROM users
GET /users/:id FROM users
POST /users FROM users
PUT /users/:id FROM users
DELETE /users/:id FROM users
```

### Authentication

```
AUTH <model> BY jwt
```

Enables JWT authentication for the specified model.

```
AUTH users BY jwt
```

### Protected Routes

```
PROTECT <path>
```

Requires JWT token for access.

```
PROTECT /users
PROTECT /posts
```

### Validation Rules

```
VALIDATE <model> {
  field: rule:rule
  field: rule:rule
}
```

Available rules:
- `required` - Field is mandatory
- `email` - Valid email format
- `min=N` - Minimum length/value
- `max=N` - Maximum length/value
- `numeric` - Numeric values only
- `alphanumeric` - Letters and numbers only
- `url` - Valid URL format
- `phone` - Valid phone number

Example:
```
VALIDATE users {
  email: required:email
  password: required:min=6
  age: numeric:min=18
  name: required:min=2:max=50
}
```

### Middleware

```
USE LOGGER
USE AUTH
```

Built-in middleware: `LOGGER`, `AUTH`, `CORS`, `COMPRESSION`

## Project Structure

```
easyjs/
├── cli/                    # Command-line interface
├── parser/                 # DSL parser & tokenizer
│   ├── Parser.js
│   ├── Tokenizer.js
│   └── ASTBuilder.js
├── compiler/               # Compiler to Express.js
│   └── Compiler.js
├── runtime/                # Runtime engine
│   └── RuntimeEngine.js
├── core/                   # Core modules
│   ├── router.js          # Route handler generation
│   ├── database.js        # Database manager
│   ├── auth.js            # Authentication & JWT
│   ├── validator.js       # Input validation
│   ├── logger.js          # Logging utility
│   └── middleware.js      # Middleware factory
├── adapters/              # Database adapters
│   ├── mongodb.js
│   └── mysql.js
├── examples/              # Example applications
├── index.js               # Entry point
├── package.json
└── README.md
```

## Security Features

### Built-in Protections

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcryptjs for secure password storage
- **Rate Limiting**: Protection against brute force attacks
- **Helmet.js**: Secure HTTP headers
- **CORS**: Configurable cross-origin resource sharing
- **Input Validation**: Comprehensive validation rules
- **Input Sanitization**: Automatic input cleaning
- **SQL Injection Prevention**: Parameterized queries

### Environment Configuration

Create `.env` file:

```
JWT_SECRET=your-secure-secret-key
JWT_EXPIRY=24h
MONGODB_URL=mongodb://localhost:27017/myapp
MYSQL_URL=mysql://root:password@localhost:3306/myapp
DEBUG=false
```

## Database Support

### MongoDB

```
USE MONGODB mongodb://user:password@host:port/dbname
```

Features:
- Automatic schema generation
- Timestamps (createdAt, updatedAt)
- Mongoose integration
- Flexible document structure

### MySQL

```
USE MYSQL mysql://user:password@localhost:3306/dbname
```

Features:
- Automatic table creation
- Connection pooling
- Prepared statements
- Transaction support ready

## Authentication

### Setup

```
AUTH users BY jwt
PROTECT /api/users
```

### API Endpoints

Authentication is handled automatically via protected routes. Include JWT token:

```
Authorization: Bearer <token>
```

### User Management

Users model receives special handling:
- Password auto-hashing
- Token generation
- Session management

## Validation

Comprehensive input validation with clear error messages:

```
VALIDATE users {
  email: required:email
  password: required:min=6:max=128
  age: numeric:min=18
}
```

Error responses:

```json
{
  "success": false,
  "error": "Validation failed",
  "details": {
    "email": ["email must be a valid email"],
    "password": ["password must be at least 6 characters"]
  }
}
```

## API Response Format

### Success Response

```json
{
  "success": true,
  "data": { /* resource data */ }
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## CLI Commands

### Create New Project

```bash
npx easybackend.js create <project-name>
```

### Start Production Server

```bash
easyjs start app.easy
```

### Development Mode (Watch Mode)

```bash
easyjs dev app.easy
```

### Add Features

```bash
easyjs add model Product
easyjs add route products
easyjs add crud products
easyjs add auth jwt
easyjs add database postgres
easyjs add page dashboard
```

### Check Provider Packages

```bash
easyjs doctor
```

If your app says `USE SUPABASE` and the SDK is missing, doctor prints:

```text
You use Supabase but @supabase/supabase-js is missing. Run npm install @supabase/supabase-js.
```

### Build for Production

```bash
easyjs build
```

### Check Before Publishing

```bash
npm run release:check
```

This runs the test suite, production smoke validation, package dry-run, real pack, and a temp consumer install from the generated tarball.

### Show Version

```bash
easyjs --version
```

### Show Help

```bash
easyjs --help
```

## Complete Example

```
START SERVER 4000

USE MONGODB mongodb://localhost:27017/blog

MODEL posts {
  title: string
  content: string
  author: string
  published: boolean
  views: number
}

MODEL comments {
  postId: string
  text: string
  author: string
}

GET /posts FROM posts
GET /posts/:id FROM posts
POST /posts FROM posts
PUT /posts/:id FROM posts
DELETE /posts/:id FROM posts

GET /posts/:postId/comments FROM comments
POST /posts/:postId/comments FROM comments
DELETE /comments/:id FROM comments

VALIDATE posts {
  title: required:min=3:max=200
  content: required:min=10
  author: required
}

VALIDATE comments {
  text: required:min=1:max=1000
  author: required
  postId: required
}

PROTECT /posts
PROTECT /comments
```

## Deployment

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
```

### Environment Variables

Set before deployment:

```bash
JWT_SECRET=production-secret-key
MONGODB_URL=mongodb+srv://user:pass@cluster.mongodb.net/proddb
NODE_ENV=production
```

## Testing Your API

### Get All Users

```bash
curl http://localhost:3000/users
```

### Create User

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "securepass123"
  }'
```

### Update User

```bash
curl -X PUT http://localhost:3000/users/123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Jane Doe"
  }'
```

### Delete User

```bash
curl -X DELETE http://localhost:3000/users/123 \
  -H "Authorization: Bearer <token>"
```

## Best Practices

1. **Environment Variables**: Always use `.env` for sensitive data
2. **Validation**: Define comprehensive validation rules
3. **Security**: Use strong JWT secrets in production
4. **Logging**: Enable debug mode during development
5. **Database**: Use connection strings with authentication
6. **Rate Limiting**: Protect public endpoints from abuse

## Troubleshooting

### Database Connection Failed

- Check database service is running
- Verify connection string in `.env`
- Check firewall rules

### Port Already in Use

```bash
easyjs start app.easy --port 3001
```

### Module Not Found

```bash
npm install
npm start
```

## License

MIT License - Feel free to use in personal and commercial projects

## Contributing

Contributions welcome! Submit issues and pull requests on GitHub.

## Support

For issues and questions:
- Open an issue on GitHub
- Check documentation
- Review examples directory

---

**easy.js** - Building backends has never been easier.
