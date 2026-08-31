const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const useSsl =
  String(process.env.DB_SSL || "").toLowerCase() === "true" ||
  Boolean(process.env.DATABASE_URL);
const rejectUnauthorized =
  String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
  "false";

const buildPoolConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized },
      min: parseInt(process.env.DB_POOL_MIN || "0", 10),
      max: parseInt(process.env.DB_POOL_MAX || "10", 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };
  }

  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "schoolmis",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    ssl: useSsl ? { rejectUnauthorized } : false,
    min: parseInt(process.env.DB_POOL_MIN || "0", 10),
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };
};

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
