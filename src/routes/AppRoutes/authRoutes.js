const express = require('express');
const router = express.Router();

const authController = require('../../controllers/authController.js');

router.post('/login', authController.login);

router.post('/create-user', authController.createUser);





module.exports = router;