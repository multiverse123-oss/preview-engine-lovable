import fs from 'fs-extra';
import path from 'path';
import { db } from '../db'; // Ensure you have this import
import { deployToNetlify } from './netlify'; // Ensure you have this import

// New interface for queue jobs
export interface PreviewJobData {
  jobId: string;
  prompt: string;
  userId: string;
}

// THIS IS THE CRITICAL NEW FUNCTION FOR THE QUEUE
export async function processPreviewJob(data: PreviewJobData): Promise<void> {
  const { jobId, prompt, userId } = data;
  let appPath = '';

  try {
    // Update status: building
    await db.previews.update(jobId, { 
      status: 'building', 
      updatedAt: new Date() 
    });

    // Step 1: Generate app code (using your existing logic)
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

// YOUR EXISTING FUNCTION - KEEP THIS AS IS
export async function generateAppCode(prompt: string): Promise<string> {
    // Create a temporary directory for the app
    const tempDir = path.join('/tmp', `preview_${Date.now()}`);
    
    // Basic React app template structure
    const template = {
        'package.json': JSON.stringify({
            name: `preview-app`,
            version: '1.0.0',
            type: 'module',
            scripts: {
                dev: 'vite',
                build: 'tsc && vite build',
                preview: 'vite preview'
            },
            dependencies: {
                'react': '^18.2.0',
                'react-dom': '^18.2.0'
            },
            devDependencies: {
                '@types/react': '^18.2.0',
                '@types/react-dom': '^18.2.0',
                '@vitejs/plugin-react': '^4.0.0',
                'typescript': '^5.0.0',
                'vite': '^5.0.0'
            }
        }, null, 2),
        
        'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
        
        'src/App.tsx': `import React from 'react';
function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif' }}>
      <h1>Preview Application</h1>
      <p>Generated from prompt: "${prompt}"</p>
      <p>This is a live preview of your application.</p>
    </div>
  );
}
export default App;`,
        
        'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
        
        'src/index.css': `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`,
        
        'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  }
})`,
        
        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                target: 'ES2020',
                useDefineForClassFields: true,
                lib: ['ES2020', 'DOM', 'DOM.Iterable'],
                module: 'ESNext',
                skipLibCheck: true,
                moduleResolution: 'bundler',
                allowImportingTsExtensions: true,
                resolveJsonModule: true,
                isolatedModules: true,
                noEmit: true,
                jsx: 'react-jsx',
                strict: true,
                noUnusedLocals: true,
                noUnusedParameters: true,
                noFallthroughCasesInSwitch: true
            },
            include: ['src'],
            references: [{ path: './tsconfig.node.json' }]
        }, null, 2),
        
        'tsconfig.node.json': JSON.stringify({
            compilerOptions: {
                composite: true,
                skipLibCheck: true,
                module: 'ESNext',
                moduleResolution: 'bundler',
                allowSyntheticDefaultImports: true,
                strict: true
            },
            include: ['vite.config.ts']
        }, null, 2)
    };

    // Create directory structure and files
    await fs.ensureDir(tempDir);
    await fs.ensureDir(path.join(tempDir, 'src'));
    
    for (const [filePath, content] of Object.entries(template)) {
        const fullPath = path.join(tempDir, filePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content);
    }

    return tempDir;
}
