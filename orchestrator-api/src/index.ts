import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db';
import { previewQueue } from './services/queue';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    queueStatus: previewQueue.client.status 
  });
});

// Create preview (ASYNC - queues the job)
app.post('/api/preview', async (req, res) => {
  try {
    const { prompt, userId } = req.body;

    // Validation
    if (!prompt || !userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: prompt and userId' 
      });
    }

    // Generate unique job ID
    const jobId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create initial database record
    await db.previews.add({
      id: jobId,
      prompt,
      userId,
      status: 'building',
      liveUrl: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Add job to the background queue (NON-BLOCKING)
    const job = await previewQueue.add(
      { jobId, prompt, userId },
      { 
        jobId, // Use the same ID for deduplication
        timeout: 120000 // 2 minute timeout for the entire job
      }
    );

    console.log(`📬 Job ${jobId} queued successfully`);

    // Return immediate response with job ID
    res.json({ 
      success: true, 
      message: 'Preview generation started in background',
      jobId,
      statusUrl: `/api/preview/${jobId}/status`
    });

  } catch (error) {
    console.error('Error queueing preview job:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to queue preview job',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check preview status
app.get('/api/preview/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;
    const preview = await db.previews.get(jobId);

    if (!preview) {
      return res.status(404).json({ 
        success: false, 
        error: 'Preview not found' 
      });
    }

    // Check if job is still in queue
    const job = await previewQueue.getJob(jobId);
    let queuePosition = null;
    
    if (job) {
      const jobCounts = await previewQueue.getJobCounts();
      queuePosition = jobCounts.waiting + jobCounts.active + 1;
    }

    res.json({
      success: true,
      ...preview,
      queuePosition: queuePosition && preview.status === 'building' ? queuePosition : null,
      estimatedTime: queuePosition ? queuePosition * 30 : null // ~30 seconds per job
    });

  } catch (error) {
    console.error('Error fetching preview status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch preview status' 
    });
  }
});

// Get all previews for a user
app.get('/api/previews/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const previews = await db.previews
      .where('userId')
      .equals(userId)
      .reverse()
      .sortBy('createdAt');

    res.json({ success: true, previews });
  } catch (error) {
    console.error('Error fetching user previews:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch previews' 
    });
  }
});

// Cancel a preview job
app.delete('/api/preview/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Remove from queue if still pending
    const job = await previewQueue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`🗑️  Removed job ${jobId} from queue`);
    }

    // Update database
    await db.previews.update(jobId, { 
      status: 'failed', 
      error: 'Cancelled by user',
      updatedAt: new Date() 
    });

    res.json({ success: true, message: 'Preview cancelled' });
  } catch (error) {
    console.error('Error cancelling preview:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cancel preview' 
    });
  }
});

// Queue stats endpoint (for monitoring)
app.get('/api/queue/stats', async (req, res) => {
  try {
    const counts = await previewQueue.getJobCounts();
    const isPaused = await previewQueue.isPaused();
    
    res.json({
      success: true,
      counts,
      isPaused,
      redisStatus: previewQueue.client.status,
      workers: 2 // Fixed concurrency from queue.ts
    });
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch queue stats' 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Preview Orchestrator API running on port ${PORT}`);
  console.log(`📊 Queue system initialized with Redis: ${process.env.REDIS_URL || 'localhost:6379'}`);
});

export default app;
