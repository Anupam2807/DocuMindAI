const Redis = require("ioredis");

const redis = new Redis({
  host: process.env.VALKEY_HOST || "localhost",
  port: process.env.VALKEY_PORT || 6379,
  password: process.env.VALKEY_PASSWORD || undefined,
});

module.exports = redis;
