const router = require('express').Router();
const ctrl   = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/register',         ctrl.register);
router.post('/login',            ctrl.login);
router.post('/refresh',          ctrl.refresh);
router.get ('/me',               authenticate, ctrl.me);
router.post('/logout',           authenticate, ctrl.logout);
router.put ('/change-password',  authenticate, ctrl.changePassword);

module.exports = router;
