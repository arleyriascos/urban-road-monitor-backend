import { defineConfig } from 'prisma/config';

// Prisma CLI does not read .env by itself: load it when it exists (local development).
// On Render the variables come from the dashboard, so the file is optional.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on variables already defined in the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
