const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const useSsl =
  Boolean(process.env.DATABASE_URL) ||
  String(process.env.DB_SSL || "").toLowerCase() === "true";
const rejectUnauthorized =
  String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
  "false";

const buildPoolConfig = () => ({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      }),
  ssl: useSsl ? { rejectUnauthorized } : false,
  min: Number(process.env.DB_POOL_MIN || 0),
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const pool = new Pool(buildPoolConfig());

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error(" Database connection failed:", err.message);
    process.exit(1);
  }
  release();
  console.log("PostgreSQL connected successfully");
});

module.exports = pool;
