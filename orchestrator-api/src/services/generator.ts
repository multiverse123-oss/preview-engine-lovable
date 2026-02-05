import fs from 'fs-extra';
import path from 'path';
import { db } from '../db';
import { deployToNetlify } from './netlify';

export interface PreviewJobData {
  jobId: string;
  prompt: string;
  userId: string;
}

export async function processPreviewJob(data: PreviewJobData): Promise<void> {
  const { jobId, prompt, userId } = data;
  let appPath = '';

  try {
    // Update status: building
    await db.previews.update(jobId, { 
      status: 'building', 
      updatedAt: new Date() 
    });

    // Step 1: Generate app code
    appPath = await generateAppCode(prompt);
    
    // Update status: generating
    await db.previews.update(jobId, { 
      status: 'generating', 
      updatedAt: new Date() 
    });

    // Step 2: Deploy to Netlify
    const liveUrl = await deployToNetlify(appPath);
    
    if (!liveUrl) {
      throw new Error('Failed to get deployment URL from Netlify');
    }

    // Update status: live
    await db.previews.update(jobId, { 
      status: 'live', 
      liveUrl,
      updatedAt: new Date() 
    });

    // Cleanup temp directory after successful deployment
    await fs.remove(appPath).catch(() => {
      // Silent fail for cleanup
    });

  } catch (error) {
    // Cleanup on error
    if (appPath) {
      await fs.remove(appPath).catch(() => {});
    }

    // Update status: failed
    await db.previews.update(jobId, { 
      status: 'failed', 
      error: error instanceof Error ? error.message : 'Unknown error',
      updatedAt: new Date() 
    });

    throw error; // Re-throw for queue retry logic
  }
}

async function generateAppCode(prompt: string): Promise<string> {
  // For now, clone a predefined template
  const templatePath = path.join(__dirname, '../../../preview-template');
  const outputPath = path.join('/tmp', `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  // Copy template with retry logic
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      await fs.copy(templatePath, outputPath);
      console.log(`✅ Template copied to: ${outputPath}`);
      break;
    } catch (copyError) {
      attempts++;
      
      if (attempts === maxAttempts) {
        throw new Error(`Failed to copy template after ${maxAttempts} attempts: ${copyError}`);
      }
      
      console.log(`🔄 Retry ${attempts}/${maxAttempts} for template copy...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
    }
  }

  // In a real scenario, you would use an LLM (like OpenAI) here to modify the template based on the prompt.
  // This is where you'd generate dynamic components, styles, etc.

  return outputPath;
}
