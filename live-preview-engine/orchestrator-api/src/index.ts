import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './db';
import { deployToNetlify } from './services/netlify';
import { generateAppCode } from './services/generator';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Root route redirects to health check
app.get('/', (req, res) => {
    res.redirect('/api/preview/health');
});

// Health check endpoint
app.get('/api/preview/health', (req, res) => {
    res.json({ status: 'ok', message: 'Preview Orchestrator API is running' });
});

// Create a new preview
app.post('/api/preview', async (req, res) => {
    try {
        const { prompt, userId } = req.body;
        const previewId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await db.previews.add({
            id: previewId,
            prompt,
            userId: userId || 'anonymous',
            status: 'building',
            liveUrl: null,
            error: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // Process in background
        processPreview(previewId, prompt).catch(console.error);

        res.json({ 
            success: true, 
            previewId, 
            message: 'Preview generation started' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: 'Failed to start preview generation' 
        });
    }
});

// Check preview status
app.get('/api/preview/:id', async (req, res) => {
    const preview = await db.previews.get(req.params.id);
    if (!preview) {
        return res.status(404).json({ error: 'Preview not found' });
    }
    res.json(preview);
});

// Background processing function
async function processPreview(previewId: string, prompt: string) {
    try {
        await db.previews.update(previewId, { 
            status: 'generating',
            updatedAt: new Date()
        });

        // Generate app code
        const appPath = await generateAppCode(prompt);
        
        await db.previews.update(previewId, { 
            status: 'deploying',
            updatedAt: new Date()
        });

        // Deploy to Netlify
        const liveUrl = await deployToNetlify(appPath, previewId);
        
        await db.previews.update(previewId, { 
            status: 'live',
            liveUrl,
            updatedAt: new Date()
        });
    } catch (error) {
        await db.previews.update(previewId, { 
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date()
        });
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Preview Orchestrator API running on port ${PORT}`);
});
