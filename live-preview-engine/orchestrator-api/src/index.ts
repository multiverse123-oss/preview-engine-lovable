import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db';
import { previewQueue } from './services/queue';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Root route redirects to health check
app.get('/', (req, res) => {
    res.redirect('/health');
});

// New health check endpoint with queue status
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        queueStatus: previewQueue.client.status,
        message: 'Preview Orchestrator API is running with queue system'
    });
});

// Keep old health endpoint for compatibility
app.get('/api/preview/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Preview Orchestrator API is running' 
    });
});

// Queue stats endpoint
app.get('/api/queue/stats', async (req, res) => {
    try {
        const counts = await previewQueue.getJobCounts();
        const isPaused = await previewQueue.isPaused();
        
        res.json({
            success: true,
            counts,
            isPaused,
            redisStatus: previewQueue.client.status,
            workers: 2
        });
    } catch (error) {
        console.error('Error fetching queue stats:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch queue stats' 
        });
    }
});

// Create a new preview (ASYNC - queues the job)
app.post('/api/preview', async (req, res) => {
    try {
        const { prompt, userId } = req.body;

        // Generate unique job ID
        const jobId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create initial database record
        await db.previews.add({
            id: jobId,
            prompt,
            userId: userId || 'anonymous',
            status: 'building',
            liveUrl: null,
            error: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Add job to the background queue (NON-BLOCKING)
        await previewQueue.add(
            { jobId, prompt, userId: userId || 'anonymous' },
            { 
                jobId, // Use the same ID for deduplication
                timeout: 120000 // 2 minute timeout for the entire job
            }
        );

        console.log(`📬 Job ${jobId} queued successfully`);

        // Return immediate response with job ID
        res.json({ 
            success: true, 
            previewId: jobId, 
            message: 'Preview generation started in background',
            statusUrl: `/api/preview/${jobId}`
        });

    } catch (error) {
        console.error('Error queueing preview job:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to start preview generation',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Check preview status (compatible with old endpoint)
app.get('/api/preview/:id', async (req, res) => {
    try {
        const preview = await db.previews.get(req.params.id);
        
        if (!preview) {
            return res.status(404).json({ 
                success: false, 
                error: 'Preview not found' 
            });
        }

        // Check if job is still in queue
        const job = await previewQueue.getJob(req.params.id);
        let queuePosition = null;
        
        if (job) {
            const jobCounts = await previewQueue.getJobCounts();
            queuePosition = jobCounts.waiting + jobCounts.active + 1;
        }

        // Return enhanced response with queue info
        res.json({
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Preview Orchestrator API running on port ${PORT}`);
    console.log(`📊 Queue system initialized with Redis: ${process.env.REDIS_URL || 'localhost:6379'}`);
});
