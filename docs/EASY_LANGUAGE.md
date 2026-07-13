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

## Seed Data

```easy
SEED users WITH [
  { "name": "Admin User", "email": "admin@example.com", "password": "securepassword", "role": "admin" }
]
```

Seed declarations populate the database with starter data. During compilation, `easy.js` generates deterministic seed files under the `seeds/` folder (e.g., `seed_users.js`).

Unlike standard seed files that wipe existing data, these generated files perform an existence check (matching on `email` for users, `id` if present, or all fields) to ensure that running them multiple times (via `easyjs seed run`) does not create duplicates or overwrite existing data.

