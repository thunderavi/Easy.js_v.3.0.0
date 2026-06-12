# easy.js Language

The language is intentionally small. A backend should read like a checklist.

## Server

```easy
START SERVER 3000
```

## Database

```easy
USE MONGODB mongodb://localhost:27017/app
USE MYSQL mysql://root:root@localhost:3306/app
```

## Security Preset

```easy
SECURITY strict
```

Strict mode means the generated app should prefer secure defaults: headers, validation, rate limits, audit logs, request limits, and safe auth behavior.

## Models

```easy
MODEL users {
  name: string
  email: email
  password: password
  role: string
}
```

## Auth

```easy
AUTH users BY jwt
AUTH refresh_tokens enabled
AUTH password_reset enabled
AUTH email_verification enabled
```

## Routes

```easy
GET /users FROM users
POST /users FROM users
PUT /users/:id FROM users
DELETE /users/:id FROM users
PROTECT /users
```

## Validation

```easy
VALIDATE users {
  email: required:email
  password: required:min=8
}
```

## Roles

```easy
ROLE admin CAN *
ROLE user CAN posts:read, posts:create
```

## Jobs

```easy
JOB cleanupExpiredTokens EVERY 1h {
  LOG "Cleaning expired auth tokens"
}
```

## Multi-file Apps

```easy
IMPORT ./models.easy
IMPORT ./auth.easy
IMPORT ./routes.easy
IMPORT ./jobs.easy
```

## ALIAS

Create an additional route that maps to the same handler as an existing route.
Useful for API versioning or renaming routes without breaking existing clients.

### Syntax

```
ALIAS <original-path> AS <alias-path>
```

### Example

```
GET /blogPosts FROM blogPosts
ALIAS /blogPosts AS /api/v1/articles
ALIAS /blogPosts/:id AS /api/v1/articles/:id
```

Both `/blogPosts` and `/api/v1/articles` serve the same handler.
The original route remains fully functional.
