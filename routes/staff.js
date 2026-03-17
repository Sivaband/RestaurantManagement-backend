const router = require('express').Router();
const ctrl   = require('../controllers/staffController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('owner'));

router.get   ('/',                   ctrl.getStaff);
router.get   ('/:id',                ctrl.getStaffById);
router.post  ('/',                   ctrl.createStaff);
router.put   ('/:id',                ctrl.updateStaff);
router.delete('/:id',                ctrl.deleteStaff);
router.patch ('/:id/reset-password', ctrl.resetPassword);

module.exports = router;
