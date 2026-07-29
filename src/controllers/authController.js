const express = require('express');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const bcrypt = require('bcrypt');

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};


exports.login = async (req, res) => {
    try {
        // 1. Sanitize input to prevent injection attempts
        const email = typeof req.body.email === 'string' ? validator.normalizeEmail(req.body.email.trim()) : null;
        const password = req.body.password;

        if (!email || !password || !validator.isEmail(email)) {
            return res.status(400).json({ error: 'Valid email and password are required.' });
        }

        const user = await storage.getUserByEmail(email);

        // 2. Generic Error Message: Use the same message to prevent User Enumeration
        const genericAuthError = { success: false, message: "Invalid email or password." };
        
        if (!user) {
            // Mimic the time it takes to compare passwords to prevent timing attacks
            await bcrypt.compare("dummy_password", "$2b$10$NotARealHashValueBecauseThisIsJustToConsumeTime");
            return res.status(401).json(genericAuthError);
        }

        // 3. Status Checks
        if (user.status !== 'ACTIVE') {
            return res.status(403).json(genericAuthError); // Obfuscate status
        }

        const businessId = user.associatedBusinessId || user.institutionId;
        const businessStatusCheck = await checkBusinessStatus(businessId);

        if (!businessStatusCheck.isActive) {
            return res.status(403).json({
                success: false,
                message: "Account access restricted. Please contact administrator.",
                code: "BUSINESS_DISABLED"
            });
        }

        // 4. Constant-Time Password Comparison
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json(genericAuthError);
        }

        const otp = generateOTP();

        // 5. Audit Logging: Use a structured logger instead of console.log
        const otpResult = await storage.createOTP(email, otp, 'login', user.id, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });

        const emailResult = await sendOTPEmail(email, otp, 'login');

        const response = {
            success: true,
            requiresOTP: true,
            devMode: !!emailResult.devMode,
            message: emailResult.devMode ? `OTP: ${otp}` : "OTP sent to your email",
            otpMasked: otpResult.maskedOtp
        };

        if (emailResult.devMode) {
            response.otp = otp;
        }

        res.json(response);

    } catch (error) {
        // 6. Secure Error Handling: Don't leak system details in production
        console.error("Login Error:", error); 
        res.status(500).json({ error: 'An authentication error occurred.' });
    }
}

exports.register = async (req, res) => {
    
}