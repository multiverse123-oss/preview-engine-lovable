import Queue from 'bull';
import { processPreviewJob } from './generator';

// Configure Redis connection
const redisConfig = {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  defaultJobOptions: {
    removeOnComplete: true,    // Remove completed jobs
    removeOnFail: false,       // Keep failed jobs for debugging
    attempts: 3,               // Retry failed jobs 3 times
    backoff: {
      type: 'exponential',     // Exponential backoff
      delay: 2000              // Start with 2 second delay
    }
  }
};

// Create the queue
export const previewQueue = new Queue('preview-generation', redisConfig);

// Process jobs from the queue (max 2 concurrent jobs to avoid overload)
previewQueue.process(2, async (job) => {
  console.log(`🚀 Processing preview job: ${job.id}`);
  
  try {
    await processPreviewJob(job.data);
    console.log(`✅ Job ${job.id} completed successfully`);
  } catch (error) {
    console.error(`❌ Job ${job.id} failed:`, error);
    throw error; // Let Bull handle retries
  }
});

// Event listeners for monitoring
previewQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed in ${job.finishedOn - job.processedOn}ms`);
});

previewQueue.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed with error:`, error);
});

// Clean old jobs periodically
setInterval(async () => {
  const completedCount = await previewQueue.getCompletedCount();
  const failedCount = await previewQueue.getFailedCount();
  
  if (completedCount > 100 || failedCount > 50) {
    await previewQueue.clean(1000 * 60 * 60 * 24); // Clean jobs older than 24 hours
    console.log('🧹 Cleaned old queue jobs');
  }
}, 1000 * 60 * 30); // Run every 30 minutes

export default previewQueue;
