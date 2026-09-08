const response = require('../response');
const { createStyleRegistryService } = require('../services/styleRegistryService');

function sendStyleError(res, error) {
  const status = error.code === 'STYLE_NOT_FOUND' ? 404 : error.code === 'CUSTOM_STYLE_IN_USE' ? 409 : 400;
  return response.error(res, status, error.code || 'STYLE_OPERATION_FAILED', error.message, error.details);
}

module.exports = function styleRoutes(db, log) {
  const registry = createStyleRegistryService({ db });
  return {
    list(req, res) {
      try {
        response.success(res, {
          items: registry.listStyles({
            category: req.query?.category,
            type: req.query?.type,
            query: req.query?.query,
            includeDisabled: req.query?.include_disabled === 'true',
          }),
        });
      } catch (error) {
        log.error('styles list', { error: error.message });
        sendStyleError(res, error);
      }
    },
    get(req, res) {
      try {
        response.success(res, registry.requireStyle(req.params.id));
      } catch (error) { sendStyleError(res, error); }
    },
    create(req, res) {
      try {
        response.created(res, registry.createCustomStyle(req.body || {}, req.user?.id || null));
      } catch (error) { sendStyleError(res, error); }
    },
    update(req, res) {
      try {
        response.success(res, registry.updateCustomStyle(req.params.id, req.body || {}));
      } catch (error) { sendStyleError(res, error); }
    },
    remove(req, res) {
      try {
        registry.deleteCustomStyle(req.params.id);
        response.success(res, { deleted: true });
      } catch (error) { sendStyleError(res, error); }
    },
  };
};
