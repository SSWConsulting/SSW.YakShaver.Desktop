# Database (Drizzle + SQLite)

This folder contains the database schema, client configuration, and migrations for the YakShaver app.

## Structure

- **client.ts** - Drizzle client initialization with SQLite
- **schema.ts** - Table definitions (currently: `shaves`)
- **migrate.ts** - Migration runner (called on app startup)
- **migrations/** - Generated SQL migration files
- **services/** - Database service layer (e.g., `ShaveService`)
- **index.ts** - Public exports

## Database Location

- **Development**: `data/database.sqlite` (project root)
- **Production**: `{userData}/database.sqlite` (Electron's app.getPath("userData"))

The `data/` folder and `*.sqlite*` files are gitignored.

## Schema: Shaves Table

```typescript
{
  id: number (auto-increment primary key)
  workItemSource: string
  title: string
  videoFile: VideoFileMetadata (JSON) {
    fileName: string
    createdAt: string (ISO date)
    duration: number (seconds)
  }
  shaveStatus: enum ("pending" | "processing" | "completed" | "failed")
  projectName?: string
  workItemUrl?: string
  createdAt: string (ISO, auto)
  updatedAt: string (ISO, auto)
}
```

## Usage

### Import the Service

```typescript
import { createShave, updateShaveStatus, getAllShaves, type VideoFileMetadata } from "./db";
```

### Create a Shave

```typescript
const videoFile: VideoFileMetadata = {
  fileName: "recording_2024_01_15.mp4",
  createdAt: new Date().toISOString(),
  duration: 180, // 3 minutes
};

const shave = await createShave({
  workItemSource: "azure-devops",
  title: "Fix login bug",
  videoFile,
  shaveStatus: "pending",
  projectName: "YakShaver",
  workItemUrl: "https://dev.azure.com/...",
});
```

### Get Shaves

```typescript
// Get all shaves
const allShaves = await getAllShaves();

// Get by ID
const shave = await getShaveById(123);

// Get by status
const pending = await getShavesByStatus("pending");

// Get by project
const projectShaves = await getShavesByProject("YakShaver");
```

### Update a Shave

```typescript
// Update any fields
await updateShave(shaveId, {
  title: "Updated title",
  shaveStatus: "completed",
});

// Update status only (type-safe)
await updateShaveStatus(shaveId, "processing");
```

### Delete a Shave

```typescript
await deleteShave(shaveId);
```

## Scripts

Available in root `package.json`:

```bash
# Generate migrations from schema changes
npm run db:generate

# Apply migrations (also runs automatically on app startup)
npm run db:migrate

# Open Drizzle Studio (GUI for browsing/editing data)
npm run db:studio
```

## Modifying the Schema

1. Edit `schema.ts` to add/change tables or columns
2. Run `npm run db:generate` to create a migration
3. Restart the app (migrations run automatically) or run `npm run db:migrate`

## Notes

- Migrations run automatically when the app starts
- Timestamps use SQLite's `CURRENT_TIMESTAMP` (ISO format)
- IDs are auto-incrementing integers
- The database file is created automatically on first run
- `videoFile` is stored as JSON and parsed automatically by Drizzle
- `shaveStatus` has enum constraint at DB level for type safety
