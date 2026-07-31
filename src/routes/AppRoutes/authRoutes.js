const express = require('express');
const router = express.Router();

const authController = require('../../controllers/authController.js');

router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);
router.post('/forgot-password', authController.forgotPassword);
router.post('/resend-reset-otp', authController.resendResetOTP);
router.post('verify-reset-otp', authController.verifyResetOTP);
router.post('/logout', authController.logout);





module.exports = router;