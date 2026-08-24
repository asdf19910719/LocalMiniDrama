const SOURCE_REQUIRED_MODES = new Set(['state_anchor', 'composition_only']);

function selectedSource(db, { sourceArtifactId, sourceCandidateId } = {}) {
  if (sourceCandidateId) {
    return db.prepare(`SELECT c.artifact_id AS artifact_id
      FROM director_candidates c
      JOIN director_candidate_groups g ON g.id = c.group_id
      JOIN director_artifacts a ON a.id = c.artifact_id AND a.status = 'ready'
      WHERE c.id = ? AND c.status = 'selected' AND g.status = 'selected'
        AND g.selected_candidate_id = c.id`).get(String(sourceCandidateId)) || null;
  }
  if (sourceArtifactId) {
    return db.prepare(`SELECT g.selected_artifact_id AS artifact_id
      FROM director_candidate_groups g
      JOIN director_artifacts a ON a.id = g.selected_artifact_id AND a.status = 'ready'
      WHERE g.selected_artifact_id = ? AND g.status = 'selected'`).get(String(sourceArtifactId)) || null;
  }
  return null;
}

function validateSourceDependency(db, inputs = {}) {
  const sourceArtifactId = inputs.sourceArtifactId || inputs.source_artifact_id;
  const sourceCandidateId = inputs.sourceCandidateId || inputs.source_candidate_id;
  const continuityMode = inputs.continuityMode || inputs.continuity_mode;
  const requiresSource = Boolean(sourceArtifactId || sourceCandidateId || inputs.requiresSource || inputs.requires_source)
    || SOURCE_REQUIRED_MODES.has(continuityMode);
  if (!requiresSource) return null;
  if (!sourceArtifactId && !sourceCandidateId) {
    throw new Error(`Continuity mode ${continuityMode || 'dependent'} requires a selected source artifact`);
  }
  const selected = selectedSource(db, { sourceArtifactId, sourceCandidateId });
  if (!selected) throw new Error('Source artifact must be selected before downstream generation');
  return selected.artifact_id;
}

module.exports = { SOURCE_REQUIRED_MODES, selectedSource, validateSourceDependency };
