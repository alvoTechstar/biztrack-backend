import { defineConfig } from 'prisma'
import { postgresAdapter } from '@prisma/adapter-postgres'
import { Pool } from 'pg'

export default defineConfig({
  adapter: postgresAdapter(new Pool({ connectionString: process.env.DATABASE_URL }))
})