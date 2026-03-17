const router = require('express').Router();
const ctrl   = require('../controllers/restaurantController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/profile',  authenticate,                    ctrl.getProfile);
router.put('/profile',  authenticate, authorize('owner'), ctrl.updateProfile);

module.exports = router;
