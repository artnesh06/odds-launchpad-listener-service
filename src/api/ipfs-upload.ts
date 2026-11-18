import { IncomingMessage, ServerResponse } from 'http';
import busboy from 'busboy';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { PinataSDK } from 'pinata';

interface TempFile {
  originalName: string;
  tempPath: string;
  mimeType: string;
  size: number;
}

/**
 * Validate Pinata credentials
 */
function validatePinataCredentials(): { jwt: string; gateway: string } {
  const jwt = process.env.PINATA_JWT;
  const gateway = process.env.PINATA_GATEWAY_URL;

  if (!jwt) {
    throw new Error('PINATA_JWT environment variable is not configured');
  }

  if (!gateway) {
    throw new Error('PINATA_GATEWAY_URL environment variable is not configured');
  }

  return { jwt, gateway };
}

/**
 * Send JSON response
 */
function sendJSON(res: ServerResponse, data: any, status: number = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: ServerResponse, message: string, status: number = 400) {
  sendJSON(res, { error: message }, status);
}

/**
 * Cleanup temporary files
 */
async function cleanupTempFiles(files: TempFile[]) {
  console.log(`🧹 Cleaning up ${files.length} temp files...`);
  for (const file of files) {
    try {
      if (fs.existsSync(file.tempPath)) {
        await fs.promises.unlink(file.tempPath);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to delete temp file ${file.tempPath}:`, err);
    }
  }
}

/**
 * Handle IPFS folder upload request (multipart/form-data)
 * POST /api/ipfs/upload-folder
 * 
 * Process:
 * 1. Upload all images to IPFS (get images CID)
 * 2. Update JSON files with image URLs from images CID
 * 3. Upload updated JSON files to IPFS (get metadata CID)
 * 4. Return metadata CID
 */
export async function handleIpfsUploadFolder(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const tempFiles: TempFile[] = [];
  const startTime = Date.now();
  let totalBytesReceived = 0;
  
  console.log('📥 Upload request received:', {
    contentLength: req.headers['content-length'],
    contentType: req.headers['content-type']?.substring(0, 50),
    timestamp: new Date().toISOString()
  });
  
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      sendError(res, 'Content-Type must be multipart/form-data', 400);
      return;
    }

    const bb = busboy({
      headers: req.headers,
      limits: {
        fileSize: parseInt(process.env.UPLOAD_MAX_FILE_BYTES || String(50 * 1024 * 1024), 10), // per file
        files: parseInt(process.env.UPLOAD_MAX_FILES || '20000', 10),
        fields: 50,
      },
    });
    let folderName = 'Uploaded Folder';
    let fileCount = 0;
    const writePromises: Promise<void>[] = [];

    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      
      // Accept both 'file' and 'files' as field names
      if (name !== 'file' && name !== 'files') {
        console.warn(`⚠️ Unexpected field name: ${name}, skipping...`);
        file.resume(); // Consume and skip
        return;
      }
      
      fileCount++;
      console.log(`📂 Receiving file #${fileCount}: ${filename} (field: ${name})`);
      
      const tempId = randomUUID();
      const tempPath = path.join(os.tmpdir(), `ipfs-upload-${tempId}.tmp`);
      
      const writeStream = fs.createWriteStream(tempPath);
      
      // Create a promise that resolves when write is complete
      const writePromise = new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => {
          tempFiles.push({
            originalName: filename || `file-${fileCount}`,
            tempPath,
            mimeType,
            size: writeStream.bytesWritten
          });
          console.log(`  ✓ Saved ${filename} (${mimeType})`);
          resolve();
        });

        writeStream.on('error', (err) => {
          console.error(`❌ Write stream error for ${filename}:`, err);
          reject(err);
        });
      });
      
      writePromises.push(writePromise);
      file.pipe(writeStream);
    });

    bb.on('field', (name, val) => {
      if (name === 'folderName') {
        folderName = val;
      }
    });

    bb.on('close', async () => {
      try {
        // Wait for all files to finish writing
        console.log(`⏳ Waiting for ${writePromises.length} files to finish writing...`);
        await Promise.all(writePromises);
        console.log(`✅ All ${tempFiles.length} files written successfully`);
        
        if (tempFiles.length === 0) {
          sendError(res, 'No files provided for upload', 400);
          return;
        }

        const totalSize = tempFiles.reduce((acc, f) => acc + f.size, 0);
        console.log('📤 Starting two-phase upload:', {
          fileCount: tempFiles.length,
          folderName,
          totalSizeEstimate: totalSize,
          memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
        });

        const { jwt, gateway } = validatePinataCredentials();

        // Initialize Pinata SDK
        const pinata = new PinataSDK({
          pinataJwt: jwt,
          pinataGateway: gateway.replace('https://', '').replace('/ipfs', '')
        });

        // Separate image files and JSON files
        const imageFiles = tempFiles.filter(f => 
          f.mimeType.startsWith('image/') || 
          /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.originalName)
        );
        const jsonFiles = tempFiles.filter(f => 
          f.originalName.endsWith('.json') ||
          f.mimeType === 'application/json'
        );

        console.log(`📊 File breakdown: ${imageFiles.length} images, ${jsonFiles.length} JSON files`);
        console.log(`  Image files:`, imageFiles.map(f => `${f.originalName} (${f.mimeType})`));
        console.log(`  JSON files:`, jsonFiles.map(f => `${f.originalName} (${f.mimeType})`));
        console.log(`  All files:`, tempFiles.map(f => `${f.originalName} (${f.mimeType})`));

        if (imageFiles.length === 0) {
          sendError(res, 'No image files found in upload', 400);
          return;
        }

        // PHASE 1: Upload images
        console.log('🖼️ Phase 1: Uploading images...');
        const imageFileObjects: File[] = [];
        for (const tempFile of imageFiles) {
          const buffer = await fs.promises.readFile(tempFile.tempPath);
          const blob = new Blob([buffer], { type: tempFile.mimeType });
          const file = new File([blob], tempFile.originalName, { type: tempFile.mimeType });
          imageFileObjects.push(file);
        }

        const imageUpload = await pinata.upload.public.fileArray(imageFileObjects).name(`${folderName}-images`);
        const imagesCID = imageUpload.cid;
        
        console.log('✅ Images uploaded:', {
          imagesCID,
          imagesUrl: `ipfs://${imagesCID}/`,
          imageCount: imageFiles.length
        });

        // PHASE 2: Update JSON files and upload
        console.log('📝 Phase 2: Updating and uploading JSON metadata...');
        const updatedJsonFiles: File[] = [];

        for (const jsonFile of jsonFiles) {
          try {
            const buffer = await fs.promises.readFile(jsonFile.tempPath);
            const jsonContent = JSON.parse(buffer.toString('utf-8'));
            
            // Update image field in JSON (if exists)
            if (jsonContent.image) {
              // Extract filename from image path (handle ./0.png, 0.png, etc)
              const imageName = jsonContent.image.replace(/^\.\//, '').split('/').pop();
              jsonContent.image = `ipfs://${imagesCID}/${imageName}`;
              console.log(`  Updated ${jsonFile.originalName}: image -> ipfs://${imagesCID}/${imageName}`);
            } else {
              console.log(`  Skipped ${jsonFile.originalName}: no image field`);
            }

            // Convert updated JSON back to File
            const updatedJsonString = JSON.stringify(jsonContent, null, 2);
            const blob = new Blob([updatedJsonString], { type: 'application/json' });
            const file = new File([blob], jsonFile.originalName, { type: 'application/json' });
            updatedJsonFiles.push(file);
            
            console.log(`  Created File: ${jsonFile.originalName} (${blob.size} bytes)`);
          } catch (jsonError: any) {
            console.error(`  ❌ Failed to process ${jsonFile.originalName}:`, jsonError.message);
            throw jsonError;
          }
        }

        if (updatedJsonFiles.length === 0) {
          sendError(res, 'No valid JSON files to upload', 400);
          return;
        }

        console.log(`📤 Uploading ${updatedJsonFiles.length} JSON files to Pinata...`);
        
        const metadataUpload = await pinata.upload.public.fileArray(updatedJsonFiles).name(`${folderName}-metadata`);
        const metadataCID = metadataUpload.cid;

        console.log('✅ Metadata uploaded:', {
          metadataCID,
          metadataUrl: `ipfs://${metadataCID}/`,
          jsonCount: jsonFiles.length
        });

        // Return metadata CID as main response (using same format as before)
        sendJSON(res, {
          success: true,
          folderCID: metadataCID,
          folderUrl: `ipfs://${metadataCID}/`,
          gatewayUrl: `${gateway}/ipfs/${metadataCID}/`,
          fileCount: tempFiles.length,
          uploadedFiles: tempFiles.map(f => f.originalName),
          // Additional info for reference
          _details: {
            imagesCID,
            imagesUrl: `ipfs://${imagesCID}/`,
            imagesGatewayUrl: `${gateway}/ipfs/${imagesCID}/`,
            breakdown: {
              images: imageFiles.length,
              metadata: jsonFiles.length
            }
          }
        });

      } catch (error: any) {
        console.error('❌ Upload Error:', error.message);
        handleUploadError(res, error);
      } finally {
        await cleanupTempFiles(tempFiles);
      }
    });

    bb.on('error', (error) => {
      console.error('Busboy parsing error:', error);
      handleUploadError(res, error);
      cleanupTempFiles(tempFiles).catch(console.error);
    });

    req.on('error', (err) => {
      console.error('❌ Request error:', err);
      cleanupTempFiles(tempFiles).catch(console.error);
    });

    req.pipe(bb);

  } catch (error) {
    handleUploadError(res, error);
    cleanupTempFiles(tempFiles).catch(console.error);
  }
}

function handleUploadError(res: ServerResponse, error: unknown) {
  console.error('❌ Folder upload failed:', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });

  let status = 500;
  let message = 'Internal server error';

  // Handle axios errors (from Pinata API)
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as any;
    if (axiosError.response?.status) {
      status = axiosError.response.status;
      message = axiosError.response.data?.error || axiosError.response.data?.message || axiosError.message;
      console.error('Pinata API response:', axiosError.response.data);
    }
  } else if (error instanceof Error) {
    message = error.message;
    
    if (
      message.includes('No files provided') ||
      message.includes('Invalid') ||
      message.includes('No boundary') ||
      message.includes('Content-Type')
    ) {
      status = 400;
    } else if (message.includes('not configured')) {
      status = 500;
      message = 'Pinata credentials not configured';
    } else if (
      message.includes('timeout') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ECONNRESET')
    ) {
      status = 504;
      message = 'Upload timed out. Please try again.';
    }
  }

  // Ensure headers haven't been sent yet
  if (!res.headersSent) {
    sendError(res, message, status);
  } else {
    res.end();
  }
}
