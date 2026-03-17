const router = require('express').Router();
const ctrl   = require('../controllers/tableController');
const { authenticate, authorize } = require('../middleware/auth');

router.get   ('/',          authenticate,                    ctrl.getTables);
router.get   ('/:id',       authenticate,                    ctrl.getTableById);
router.post  ('/',          authenticate, authorize('owner'), ctrl.createTable);
router.put   ('/:id',       authenticate, authorize('owner'), ctrl.updateTable);
router.delete('/:id',       authenticate, authorize('owner'), ctrl.deleteTable);
router.patch ('/:id/status',authenticate,                    ctrl.updateStatus);
router.post  ('/:id/qr',    authenticate, authorize('owner'), ctrl.regenerateQR);

module.exports = router;
