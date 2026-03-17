const router = require('express').Router();
const ctrl   = require('../controllers/menuController');
const { authenticate, authorize } = require('../middleware/auth');

// ── Public (QR customers) ──────────────────────────────────────────────────────
router.get('/public', ctrl.getPublicMenu);

// ── Categories ─────────────────────────────────────────────────────────────────
router.get   ('/categories',     authenticate,                    ctrl.getCategories);
router.post  ('/categories',     authenticate, authorize('owner'), ctrl.createCategory);
router.put   ('/categories/:id', authenticate, authorize('owner'), ctrl.updateCategory);
router.delete('/categories/:id', authenticate, authorize('owner'), ctrl.deleteCategory);

// ── Menu Items ─────────────────────────────────────────────────────────────────
router.get   ('/items',          authenticate,                    ctrl.getItems);
router.get   ('/items/:id',      authenticate,                    ctrl.getItemById);
router.post  ('/items',          authenticate, authorize('owner'), ctrl.createItem);
router.put   ('/items/:id',      authenticate, authorize('owner'), ctrl.updateItem);
router.delete('/items/:id',      authenticate, authorize('owner'), ctrl.deleteItem);
router.patch ('/items/:id/toggle', authenticate, authorize('owner'), ctrl.toggleAvailability);

module.exports = router;
