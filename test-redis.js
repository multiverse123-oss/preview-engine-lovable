require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

redis.on('connect', () => {
  console.log('✅ Successfully connected to Redis');
  process.exit(0);
});
redis.on('error', (err) => {
  console.error('❌ Failed to connect to Redis:', err);
  process.exit(1);
});
