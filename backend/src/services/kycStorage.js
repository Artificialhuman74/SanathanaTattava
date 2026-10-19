/**
 * Private storage for rider KYC photos (selfie, licence, PAN).
 *
 * Unlike refund proofs, these are identity documents, so they never go under
 * the public /uploads static route. They live in ${DATA_DIR}/kyc/ (same volume
 * as the DB, so they survive redeploys) and are only streamed to admins via
 * GET /api/admin/riders/:id/kyc/:kind. File names are random UUIDs; the users
 * table stores the name, and that row is the only way to reach a file.
 *
 * Each photo is kept twice, both WebP (small, and fast to decode everywhere):
 *   <uuid>.webp        1600px, for zooming in to read a licence
 *   <uuid>.thumb.webp   480px, a few KB, for review grids and lists
 * Never put these behind a public CDN cache: they are identity documents.
 */
const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const KYC_DIR  = path.join(DATA_DIR, 'kyc');

try { fs.mkdirSync(KYC_DIR, { recursive: true }); } catch (_) {}

/* Upload field name → users column. */
const KYC_FIELDS = {
  selfie:        'kyc_selfie',
  licence_front: 'kyc_licence_front',
  licence_back:  'kyc_licence_back',
  pan_photo:     'kyc_pan',
};

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const thumbName = (filename) => filename.replace(/\.webp$/, '.thumb.webp');

/** Converts an uploaded photo to WebP (full + thumbnail) and returns the stored file name. */
async function saveKycImage(buffer) {
  const filename = `${randomUUID()}.webp`;
  const upright = sharp(buffer).rotate(); // honour EXIF orientation
  await Promise.all([
    upright.clone()
      // Enough pixels to read licence text when zoomed, without paying for a 12 MP original.
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, smartSubsample: true })
      .toFile(path.join(KYC_DIR, filename)),
    upright.clone()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 68, smartSubsample: true })
      .toFile(path.join(KYC_DIR, thumbName(filename))),
  ]);
  return filename;
}

/**
 * Absolute path for a stored name, or null if the name isn't one of ours.
 * size 'thumb' returns the small copy (falling back to the full one for older uploads).
 */
function kycFilePath(filename, size = 'full') {
  if (!filename || !/^[0-9a-f-]{36}\.webp$/.test(filename)) return null;
  if (size === 'thumb') {
    const thumb = path.join(KYC_DIR, thumbName(filename));
    if (fs.existsSync(thumb)) return thumb;
  }
  const full = path.join(KYC_DIR, filename);
  return fs.existsSync(full) ? full : null;
}

function removeKycFile(filename) {
  if (!filename || !/^[0-9a-f-]{36}\.webp$/.test(filename)) return;
  for (const name of [filename, thumbName(filename)]) {
    try { fs.unlinkSync(path.join(KYC_DIR, name)); } catch (_) {}
  }
}

module.exports = { KYC_DIR, KYC_FIELDS, ALLOWED_MIME, saveKycImage, kycFilePath, removeKycFile };
