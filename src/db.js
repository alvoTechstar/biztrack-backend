// Prisma connects lazily on first query — no explicit connect() needed.
// This file is kept as a no-op so existing imports don't break.
const connectDB = async () => {
  console.log("PostgreSQL (Prisma) — connection is established on first query");
};

export default connectDB;