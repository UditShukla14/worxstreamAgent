import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { compareStocks } from '../utils/compareStocks.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ 
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * POST /api/price-comparison/upload-and-compare
 * Upload two files and compare them
 */
router.post('/upload-and-compare', upload.fields([
  { name: 'oldFile', maxCount: 1 },
  { name: 'newFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.oldFile || !req.files.newFile) {
      return res.status(400).json({
        success: false,
        error: 'Both oldFile and newFile are required'
      });
    }

    const oldFilePath = req.files.oldFile[0].path;
    const newFilePath = req.files.newFile[0].path;

    // Perform comparison
    const comparisonResult = compareStocks(oldFilePath, newFilePath);

    // Cleanup uploaded files
    try {
      fs.unlinkSync(oldFilePath);
      fs.unlinkSync(newFilePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup files:', cleanupError);
    }

    res.json({
      success: true,
      data: comparisonResult
    });
  } catch (error) {
    console.error('Price comparison error:', error);
    
    // Cleanup on error
    if (req.files?.oldFile?.[0]?.path) {
      try { fs.unlinkSync(req.files.oldFile[0].path); } catch {}
    }
    if (req.files?.newFile?.[0]?.path) {
      try { fs.unlinkSync(req.files.newFile[0].path); } catch {}
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to compare files'
    });
  }
});

export default router;

