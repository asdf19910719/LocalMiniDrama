const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const response = require('../response');
const svc = require('../services/externalGenerationService');
const refs = require('../services/externalGenerationReferenceService');
const importer = require('../services/externalGenerationImportService');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = (db) => {
  const r = express.Router();
  const idempotent = async (req, operation, fn, res) => {
    try { const value = await svc.runIdempotent(db, req.get('Idempotency-Key'), operation, fn); response.success(res, value); }
    catch(e) { response.badRequest(res,e.message); }
  };
  r.post('/external-generation/jobs', (req,res) => idempotent(req, 'create-job', () => svc.createExternalJob(db, req.body || {}), res));
  r.get('/external-generation/jobs/:jobId', (req,res) => response.success(res, svc.getExternalJob(db, req.params.jobId)));
  r.get('/external-generation/results/:resultId/content', (req, res) => {
    const row = db.prepare(`SELECT image.local_path, image.width, image.height FROM external_generation_results result
      JOIN image_generations image ON image.id = result.image_generation_id WHERE result.id=?`).get(req.params.resultId);
    if (!row || !row.local_path || !fs.existsSync(row.local_path)) return response.notFound(res, 'Imported result file not found');
    return res.sendFile(row.local_path);
  });
  const listJobs = (req, res) => response.success(res, db.prepare('SELECT * FROM external_generation_jobs WHERE drama_id=? ORDER BY created_at DESC').all(req.params.dramaId));
  r.get('/external-generation/drama/:dramaId/jobs', listJobs);
  r.get('/external-generation/dramas/:dramaId/jobs', listJobs);
  r.post('/external-generation/jobs/:jobId/prepare', (req,res) => idempotent(req, `prepare-job:${req.params.jobId}`, () => refs.prepareReferencePackage(db, req.params.jobId, req.body?.references || []), res));
  r.post('/external-generation/jobs/:jobId/attempts', (req,res) => idempotent(req, `create-attempt:${req.params.jobId}`, () => svc.createGenerationAttempt(db, req.params.jobId, req.body || {}), res));
  r.post('/external-generation/attempts/:attemptId/events', (req,res) => idempotent(req, `attempt-event:${req.params.attemptId}`, () => svc.recordAttemptEvent(db, req.params.attemptId, req.body || {}), res));
  r.get('/external-generation/dramas/:dramaId/session', (req,res) => response.success(res, svc.getProjectSession(db, req.params.dramaId, req.query.site)));
  r.post('/external-generation/dramas/:dramaId/session/attach', (req,res) => idempotent(req, `attach-session:${req.params.dramaId}`, () => svc.attachProjectSession(db, req.params.dramaId, req.body || {}), res));
  r.post('/external-generation/results/import', upload.single('file'), async (req,res) => idempotent(req, 'import-result', () => { const body = { ...(req.body || {}), bytes: req.file?.buffer }; return importer.importExternalResult(db, { ...body, resultIndex: Number(body.resultIndex) }); }, res));
  r.post('/external-generation/results/:resultId/rebind', (req,res) => idempotent(req, `rebind-result:${req.params.resultId}`, () => importer.rebindExternalResult(db, req.params.resultId, req.body?.storyboardId), res));
  return r;
};
