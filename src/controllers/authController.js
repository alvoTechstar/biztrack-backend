const express = require('express');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const bcrypt = require('bcrypt');
const z = require('zod');
const { storage } = require('../utils/storage.js');
const { transporter } = require('../services/mailer.js');
require('dotenv').config();

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const canAccessBusiness = (user, businessId) => {
    console.log('🔍 Checking business access:', {
            userId: user?.id,
            userRole: user?.role,
            targetBusinessId: businessId
        });

        // SUPER ADMIN and BizTrack Admin can access all businesses
        if (user.role === 'Super_Admin' || user.role === 'Biztrack_ADMIN') {
            console.log('✅ Access granted: Super Admin / BizTrack Admin');
            return true;
        }

        // Get all possible business IDs from the user
        const userBusinessIds = [
            String(user.businessId || '').trim(),
            String(user.associatedBusinessId || '').trim(),
            String(user.institutionId || '').trim(),
            String(user.businessUUID || '').trim()
        ].filter(id => id.length > 0);

        const targetBusinessId = String(businessId || '').trim();

        console.log(`🔍 Business ID comparison:`, {
            userBusinessIds,
            targetBusinessId,
            hasMatch: userBusinessIds.includes(targetBusinessId)
        });

        // Check exact match
        if (userBusinessIds.includes(targetBusinessId)) {
            console.log('✅ Access granted: Exact business ID match');
            return true;
        }

        // Try numeric comparison
        for (const userBusinessId of userBusinessIds) {
            const userNum = parseInt(userBusinessId, 10);
            const targetNum = parseInt(targetBusinessId, 10);

            if (!isNaN(userNum) && !isNaN(targetNum) && userNum === targetNum) {
                console.log('✅ Access granted: Numeric business ID match');
                return true;
            }
        }

        console.log(`❌ Access denied: No business ID match`);
        return false;
};

const checkBusinessStatus = async (businessId) => {
    if (!businessId) {
        return {
            isActive: true,
            message: 'No business associated'
        };
    }

    try {
        const business = await storage.getBusiness(businessId);

        if (!business) {
            return {
                isActive: false,
                message: 'Business not found'
            };
        }

        const businessStatus = business.status ? business.status.toLowerCase() : 'active';
        const isActive = !['inactive', 'disabled', 'suspended'].includes(businessStatus);

        return {
            isActive,
            businessStatus,
            businessName: business.businessName,
            business
        };
    } catch (error) {
        console.error('Error checking business status:', error);
        return {
            isActive: false,
            message: 'Error checking business status'
        };
    }
}

const sendOTPEmail = async (email, otp, type = 'login') => {
    // Check if email is configured
    if (!transporter || !process.env.EMAIL_USER || !process.env.SMTP_PASS) {
        return {
            success: false,
            devMode: true,
            error: "Email service not configured. Set EMAIL_USER and SMTP_PASS environment variables."
        };
    }

    const subject = type === 'login'
        ? 'Your Login OTP - BizTrack'
        : 'Password Reset OTP - BizTrack';

    try {
        const mailOptions = {
            from: {
                name: 'BizTrack Application',
                address: process.env.EMAIL_USER
            },
            to: email,
            subject: subject,
            // Simple HTML email
            html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .otp-box { background: #f8f9fa; padding: 25px; text-align: center; border-radius: 8px; margin: 20px 0; border: 2px solid #dee2e6; }
                    .otp-code { font-size: 36px; font-weight: bold; color: #4F46E5; letter-spacing: 8px; margin: 10px 0; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>BizTrack Application</h1>
                    </div>
                    
                    <p>Hello,</p>
                    <p>Use the following OTP to complete your ${type === 'login' ? 'login' : 'password reset'}:</p>
                    
                    <div class="otp-box">
                        <div class="otp-code">${otp}</div>
                        <p>This code will expire in 10 minutes</p>
                    </div>
                    
                    <p><strong>Security Notice:</strong> Never share this OTP with anyone.</p>
                    
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} BizTrack Application</p>
                    </div>
                </div>
            </body>
            </html>
            `,
            // Plain text fallback
            text: `Your BizTrack OTP is: ${otp}. This code expires in 10 minutes.`
        };

        // Send email with timeout
        const sendPromise = transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Email sending timeout after 15 seconds')), 15000);
        });

        const info = await Promise.race([sendPromise, timeoutPromise]);

        return {
            success: true,
            messageId: info.messageId
        };

    } catch (error) {
        console.error('Email sending failed:', error.message);

        // Return dev mode if email fails
        return {
            success: false,
            error: error.message,
            devMode: true
        };
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const user = await storage.getUserByEmail(email.trim().toLowerCase());
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        if (user.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                message: "Your account is not active. Please contact administrator."
            });
        }

        // Check user's business status BEFORE allowing login
        const businessId = user.associatedBusinessId || user.institutionId;
        const businessStatusCheck = await checkBusinessStatus(businessId);

        if (!businessStatusCheck.isActive) {
            return res.status(403).json({
                success: false,
                message: `Your business "${businessStatusCheck.businessName || 'account'}" has been ${businessStatusCheck.businessStatus}. Please contact your administrator.`,
                businessStatus: businessStatusCheck.businessStatus,
                code: "BUSINESS_DISABLED"
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const otp = generateOTP();

        // Save OTP to database
        const otpResult = await storage.createOTP(
            email,
            otp,
            'login',
            user.id,
            {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            }
        );

        // Send OTP email
        const emailResult = await sendOTPEmail(email, otp, 'login');

        const response = {
            success: true,
            requiresOTP: true,
            devMode: emailResult.devMode || false,
            message: emailResult.devMode
                ? `OTP: ${otp} (Email service: ${emailResult.error || 'Not configured'})`
                : "OTP sent to your email",
            otpMasked: otpResult.maskedOtp
        };

        // Include OTP in response for dev mode
        if (emailResult.devMode) {
            response.otp = otp;
        }

        res.json(response);

    } catch (error) {
        console.error("========================================");
        console.error("🚨 LOGIN ERROR");
        console.error("========================================");
        console.error("Message:", error?.message);
        console.error("Name:", error?.name);
        console.error("Stack:");
        console.error(error?.stack);
        console.error("Full Error Object:");
        console.dir(error, { depth: null });
        console.error("========================================");

        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error?.message
        });
    }
}

exports.createUser = async (req, res) => {
    try {
        const body = req.body;

        console.log("📨 Creating user:", {
            email: body.email,
            username: body.username,
            businessId: body.businessId,
            businessIdType: typeof body.businessId,
            requestedBy: req.user?.id || 'N/A',
            requestedRole: req.user?.role || 'N/A'
        });

        // 1. Validate business access
        if (!canAccessBusiness(req.user, body.businessId)) {
            return res.status(403).json({
                success: false,
                message: 'You can only create users for your assigned business.'
            });
        }

        // 2. Fetch the business
        const business = await storage.getBusiness(body.businessId);
        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business not found.'
            });
        }

        const businessObj = business.toObject ? business.toObject() : business;

        console.log('✅ Found business:', {
            name: businessObj.businessName,
            businessId: businessObj.businessId,
            id: businessObj.id
        });

        // 3. Normalize the role based on business type
        const normalizedRole = normalizeRole(body.role, businessObj.businessType);

        // 4. Validate role for business type
        if (!validateRoleForBusinessType(normalizedRole, businessObj.businessType)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role "${body.role}" for business type "${businessObj.businessType}".`,
                allowedRoles: getRolesForBusinessType(businessObj.businessType)
            });
        }

        // 5. Generate temporary password
        const tempPassword = Math.random().toString(36).slice(-8);

        // 6. CRITICAL FIX: Prepare data with NUMERIC businessId
        const userData = {
            username: body.username,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: body.phoneNumber,
            role: normalizedRole,
            password: tempPassword,

            // CRITICAL: Store as NUMERIC
            businessId: parseInt(businessObj.businessId, 10),

            // Also store UUID for compatibility
            businessUUID: businessObj.id || businessObj.businessUUID,

            // Keep string versions for backward compatibility
            associatedBusinessId: String(businessObj.businessId),
            institutionId: String(businessObj.businessId),

            // Business metadata
            businessName: businessObj.businessName,
            institutionName: businessObj.businessName,

            status: 'ACTIVE',
            lastLogin: 'Never',
            createdBy: req.user.id,
            createdAt: new Date().toISOString(),
        };

        console.log('📦 User data to be saved:', {
            username: userData.username,
            businessId: userData.businessId,
            businessIdType: typeof userData.businessId,
            businessUUID: userData.businessUUID,
            associatedBusinessId: userData.associatedBusinessId
        });

        // 7. Check for unique username and email
        const existingUsername = await storage.getUserByUsername(userData.username);
        if (existingUsername) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists.'
            });
        }

        const existingEmail = await storage.getUserByEmail(userData.email);
        if (existingEmail) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists.'
            });
        }

        // 8. Create User in DB
        const newUser = await storage.createUser(userData);

        console.log('✅ User created:', {
            id: newUser.id || newUser._id,
            username: newUser.username,
            businessId: newUser.businessId,
            businessIdType: typeof newUser.businessId
        });

        // 9. Generate password reset token and send email
        const resetToken = generatePasswordResetToken();
        const emailSent = await sendPasswordResetEmail(newUser, resetToken, businessObj);

        console.log(`✅ User created successfully: ${newUser.username} for business: ${businessObj.businessName}`);

        res.status(201).json({
            success: true,
            message: emailSent
                ? 'User created successfully. Password reset email sent.'
                : 'User created successfully. Email notification failed.',
            user: {
                id: newUser.id || newUser._id,
                username: newUser.username,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                email: newUser.email,
                phone: newUser.phone,
                role: newUser.role,
                status: newUser.status,
                businessId: newUser.businessId,
                businessUUID: newUser.businessUUID,
                businessName: businessObj.businessName,
                businessType: businessObj.businessType,
            },
            emailSent
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("❌ Validation Error:", error.errors);
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: error.errors
            });
        }
        console.error('🚨 User creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during user creation.',
            error: error.message
        });
    }
}