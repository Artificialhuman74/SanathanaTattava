/**
 * Photo upload middleware — accepts a single image, converts to WebP,
 * writes to ${DATA_DIR}/uploads/<subdir>/<uuid>.webp, and replaces
 * req.file with { ..., url, absolutePath, webpFilename } pointing at
 * the post-conversion file.
 *
 * Why WebP: ~30% smaller than JPEG at similar quality, and modern
 * browsers (including iOS Safari 14+) render it natively, so we save
 * the consumer/admin bandwidth on every page load.
 */
const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');
const sharp  = require('sharp');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/* In-memory storage — sharp reads from buffer and writes the final WebP. */
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB raw cap
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`Unsupported image type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

/**
 * Returns Express middleware that accepts a single image upload under `fieldName`
 * and writes its WebP-converted output to /uploads/<subdir>/<uuid>.webp.
 *
 *   const upload = uploadProof('proof', 'refunds');
 *   router.post('/foo', upload, handler);
 *
 * After this middleware runs, req.file contains:
 *   { url, absolutePath, webpFilename, size }
 *
 * If no file was attached, req.file is undefined (handler decides if required).
 */
function uploadProof(fieldName, subdir) {
  const subdirPath = path.join(UPLOADS_DIR, subdir);
  try { fs.mkdirSync(subdirPath, { recursive: true }); } catch (_) {}

  const single = memUpload.single(fieldName);
  return (req, res, next) => {
    single(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      if (!req.file) return next();
      try {
        const filename = `${Date.now()}-${randomUUID()}.webp`;
        const absolutePath = path.join(subdirPath, filename);
        await sharp(req.file.buffer)
          .rotate() // honour EXIF orientation so portrait pics aren't sideways
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(absolutePath);
        const stat = fs.statSync(absolutePath);
        req.file.url = `/uploads/${subdir}/${filename}`;
        req.file.absolutePath = absolutePath;
        req.file.webpFilename = filename;
        req.file.size = stat.size;
        delete req.file.buffer; // release memory
        next();
      } catch (e) {
        console.error('[uploadProof] sharp failed:', e);
        res.status(400).json({ error: 'Could not process image' });
      }
    });
  };
}

module.exports = { uploadProof, UPLOADS_DIR };
