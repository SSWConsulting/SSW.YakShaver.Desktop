## Overview

YakShaver uses **SQLite** as its database with **Drizzle ORM** for schema management and migrations. The database stores information about video shaves including metadata, status, and associated work items.

### Technology Stack
- **Database**: SQLite (better-sqlite3)
- **ORM**: Drizzle ORM
- **Migration Tool**: Drizzle Kit

## Database Structure

## File Structure

```
db/
├── client.ts          # SQLite database client initialization
├── schema.ts          # Drizzle schema definitions
├── migrate.ts         # Migration runner and initialization
├── index.ts           # Public exports
├── migrations/        # Generated migration files
│   ├── meta/
│   │   └── _journal.json
│   └── 0000_adorable_tombstone.sql
└── services/
    └── shave-service.ts  # Database service layer
```

## Setup Steps

### 1. Initial Development Setup

When setting up the project, the postinstall script will automatically rebuild better-sqlite3 to ensure that the better-sqlite3 native bindings are rebuilt to match the Node.js version used by Electron.

### 2. Generate Database Files

If you modify the schema (`schema.ts`), you must generate new migrations:

```bash
npm run db:generate
```

This creates SQL migration files in `src/backend/db/migrations/`.

**Important**: Always commit generated migration files to version control.

### 3. Run Migrations

Migrations run automatically when the application starts via the `initDatabase()` function in `migrate.ts`.

To manually run migrations:

```bash
npm run db:migrate
```

### 4. Access Database in Development

To view and inspect the database in development or use other tools like DB Broswer

```bash
npm run db:studio
```

This opens the Drizzle Studio UI where you can browse tables, query data, and manage records.

## Current Implementation

### Automatic Initialization

The database is initialized automatically when the Electron app starts:

1. **Client Creation** (`client.ts`):
   - Creates SQLite database instance
   - Ensures directory exists
   - Initializes Drizzle ORM with schema

2. **Migrations** (`migrate.ts`):
   - Runs on app startup via `initDatabase()`
   - Applies all pending migrations
   - Verifies required tables exist

### Production Migrations

For production builds, migrations are included in `extraResources` (outside the ASAR archive) to allow for updates without rebuilding the app.

## Development Workflow

### Modifying the Schema

1. Edit `src/backend/db/schema.ts`
2. Run `npm run db:generate`
3. Review the generated migration file in `src/backend/db/migrations/`
4. Commit both the schema and migration files
5. Test migrations locally

### Adding New Tables

```typescript
// In schema.ts
export const newTable = sqliteTable("new_table", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  name: text("name").notNull(),
  // ... add columns
});

export type NewTableRecord = typeof newTable.$inferSelect;
export type NewTableInsert = typeof newTable.$inferInsert;
```

Then run `npm run db:generate`.

## Important Notes

### better-sqlite3 Setup

The `postinstall` script automatically rebuilds `better-sqlite3` for Electron:

```json
"postinstall": "electron-rebuild -f -w better-sqlite3"
```

If you encounter issues with native bindings, run this command manually:

```bash
npm run postinstall
```

### Migration Path Logic

The migration path resolution (`getMigrationsPath()` in `migrate.ts`) checks multiple locations:

1. **Development**: `src/backend/db/migrations` (from project root)
2. **Production**: `process.resourcesPath/migrations` (extraResources)
3. **Fallback**: `__dirname/migrations` (inside ASAR - not recommended)


## Troubleshooting

### Database not found in production
- Ensure migrations are included in `extraResources` in the electron-builder config
- Check that `_journal.json` exists in the migrations folder

### Schema changes not applied
- Run `npm run db:generate` after modifying `schema.ts`
- Commit the generated migration files
- Rebuild and restart the application

### better-sqlite3 errors
- Run `npm run postinstall` to rebuild native bindings
- Ensure Node.js version is compatible with Electron version
